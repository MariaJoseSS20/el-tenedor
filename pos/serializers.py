"""
Serializers DRF — El Tenedor.

Incluye Venta anidada con DetalleVenta y el payload de sync offline masivo.
Sin control de stock: las ventas no descuentan cantidades de inventario.
"""

from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from .models import (
    CajaDiaria,
    CustomUser,
    DetallePedido,
    DetalleVenta,
    Inventario,
    Pedido,
    Producto,
    Venta,
)

# Cobro fijo de delivery en pedidos web (mismo default del POS).
COBRO_DELIVERY_WEB = Decimal("1500.00")
USUARIO_PEDIDOS_WEB = "pedidos-web"


def validar_entrega_y_cobro(tipo, cobro):
    """Misma regla para venta online y sync offline."""
    if cobro is None:
        cobro = Decimal("0.00")
    if tipo == Venta.TipoEntrega.RETIRO and cobro > 0:
        raise serializers.ValidationError(
            {"cobro_delivery": "Retiro en local no debe incluir cobro de delivery."}
        )
    if tipo == Venta.TipoEntrega.DELIVERY and cobro < 0:
        raise serializers.ValidationError(
            {"cobro_delivery": "Indique un cobro de delivery válido (>= 0)."}
        )
    return cobro


def normalizar_fecha_sync(fecha):
    """
    Acepta la fecha del dispositivo solo si no es futura (margen 2 min)
    y no es anterior al inicio del día local (TIME_ZONE del proyecto).
    Si no viene, usa ahora del servidor.
    """
    ahora = timezone.now()
    if fecha is None:
        return ahora

    if timezone.is_naive(fecha):
        fecha = timezone.make_aware(fecha, timezone.get_current_timezone())

    if fecha > ahora + timedelta(minutes=2):
        raise serializers.ValidationError(
            {"fecha_hora": "La fecha de la venta no puede ser futura."}
        )

    inicio_dia = timezone.localtime(ahora).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    if timezone.localtime(fecha) < inicio_dia:
        raise serializers.ValidationError(
            {
                "fecha_hora": (
                    "La venta offline solo se acepta con fecha del día local actual."
                )
            }
        )
    return fecha


def dia_ya_cerrado(fecha_hora):
    """True si existe CajaDiaria para la fecha local de fecha_hora."""
    fecha = timezone.localtime(fecha_hora).date()
    return CajaDiaria.objects.filter(fecha=fecha).exists()


class CustomUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomUser
        fields = ("id", "username", "first_name", "last_name", "email", "rol")
        read_only_fields = fields


class InventarioSerializer(serializers.ModelSerializer):
    producto_nombre = serializers.CharField(source="producto.nombre", read_only=True)
    producto_categoria = serializers.CharField(source="producto.categoria", read_only=True)
    producto_estado = serializers.CharField(source="producto.estado", read_only=True)
    producto_precio = serializers.DecimalField(
        source="producto.precio",
        max_digits=10,
        decimal_places=2,
        read_only=True,
    )

    class Meta:
        model = Inventario
        fields = (
            "id",
            "producto",
            "producto_nombre",
            "producto_categoria",
            "producto_estado",
            "producto_precio",
            "notas",
            "ultima_actualizacion",
        )
        read_only_fields = ("ultima_actualizacion",)

    def validate_producto(self, producto):
        qs = Inventario.objects.filter(producto=producto)
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError(
                f"'{producto.nombre}' ya está en el inventario."
            )
        return producto


class ProductoSerializer(serializers.ModelSerializer):
    inventario = InventarioSerializer(read_only=True)

    class Meta:
        model = Producto
        fields = (
            "id",
            "nombre",
            "descripcion",
            "precio",
            "categoria",
            "codigo_barras",
            "estado",
            "inventario",
            "creado_en",
            "actualizado_en",
        )
        read_only_fields = ("creado_en", "actualizado_en")

    def validate_precio(self, value):
        if value is None or value <= 0:
            raise serializers.ValidationError("El precio debe ser mayor que 0.")
        return value


class DetalleVentaSerializer(serializers.ModelSerializer):
    producto_nombre = serializers.CharField(source="producto.nombre", read_only=True)

    class Meta:
        model = DetalleVenta
        fields = ("id", "producto", "producto_nombre", "cantidad", "subtotal", "notas")
        read_only_fields = ("id", "subtotal")

    def validate_cantidad(self, value):
        if value is None or value < 1:
            raise serializers.ValidationError("La cantidad debe ser al menos 1.")
        return value


class VentaSerializer(serializers.ModelSerializer):
    """
    Serializer anidado: crea Venta + DetalleVenta en una sola petición.
    El cajero se toma del usuario autenticado (trazabilidad).
    fecha_hora es solo lectura: la fija el servidor.
    """

    detalles = DetalleVentaSerializer(many=True)
    cajero = CustomUserSerializer(read_only=True)
    cajero_id = serializers.PrimaryKeyRelatedField(source="cajero", read_only=True)

    class Meta:
        model = Venta
        fields = (
            "id",
            "client_uuid",
            "cajero",
            "cajero_id",
            "fecha_hora",
            "total",
            "metodo_pago",
            "tipo_entrega",
            "cobro_delivery",
            "estado",
            "notas",
            "detalles",
            "creado_en",
        )
        read_only_fields = (
            "id",
            "total",
            "estado",
            "creado_en",
            "cajero",
            "cajero_id",
            "fecha_hora",
        )

    def validate_detalles(self, value):
        if not value:
            raise serializers.ValidationError("La venta debe incluir al menos un detalle.")
        return value

    def validate(self, attrs):
        tipo = attrs.get("tipo_entrega")
        cobro = attrs.get("cobro_delivery", Decimal("0.00"))
        validar_entrega_y_cobro(tipo, cobro)
        return attrs

    def _validar_y_obtener_productos(self, detalles_data):
        """Valida que los productos existan y estén activos."""
        ids = {item["producto"].pk for item in detalles_data}
        productos = {
            p.pk: p
            for p in Producto.objects.filter(pk__in=ids)
        }

        for producto_id in ids:
            producto = productos.get(producto_id)
            if producto is None:
                raise serializers.ValidationError(
                    {"detalles": f"Producto id={producto_id} no existe."}
                )
            if producto.estado != Producto.Estado.ACTIVO:
                raise serializers.ValidationError(
                    {"detalles": f"El producto '{producto.nombre}' está inactivo."}
                )
        return productos

    @transaction.atomic
    def create(self, validated_data):
        detalles_data = validated_data.pop("detalles")
        request = self.context["request"]
        validated_data["cajero"] = request.user
        validated_data["estado"] = Venta.Estado.COMPLETADA
        validated_data["fecha_hora"] = timezone.now()

        if dia_ya_cerrado(validated_data["fecha_hora"]):
            raise serializers.ValidationError(
                {
                    "detail": (
                        "No se pueden registrar ventas: la caja del día ya está cerrada."
                    )
                }
            )

        productos = self._validar_y_obtener_productos(detalles_data)

        venta = Venta.objects.create(**validated_data)
        total_detalles = Decimal("0.00")

        for item in detalles_data:
            producto = productos[item["producto"].pk]
            cantidad = item["cantidad"]
            subtotal = (producto.precio * cantidad).quantize(Decimal("0.01"))
            DetalleVenta.objects.create(
                venta=venta,
                producto=producto,
                cantidad=cantidad,
                subtotal=subtotal,
                notas=item.get("notas") or "",
            )
            total_detalles += subtotal

        cobro = validated_data.get("cobro_delivery") or Decimal("0.00")
        venta.total = total_detalles + cobro
        venta.save(update_fields=["total"])
        return venta


class SyncVentaItemSerializer(serializers.Serializer):
    """
    Ítem del lote offline. La validación de negocio (fecha, delivery, productos)
    se hace por ítem en la vista para no bloquear el resto del lote.
    """

    client_uuid = serializers.UUIDField(required=True)
    fecha_hora = serializers.DateTimeField(required=False, allow_null=True)
    metodo_pago = serializers.ChoiceField(choices=Venta.MetodoPago.choices)
    tipo_entrega = serializers.ChoiceField(choices=Venta.TipoEntrega.choices)
    cobro_delivery = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        required=False,
        default=Decimal("0.00"),
    )
    notas = serializers.CharField(required=False, allow_blank=True, default="")
    detalles = DetalleVentaSerializer(many=True)

    def validate_detalles(self, value):
        if not value:
            raise serializers.ValidationError("Cada venta debe incluir al menos un detalle.")
        return value


class SyncVentasSerializer(serializers.Serializer):
    """
    Payload de POST /api/sync-ventas/

    Espera un array JSON de ventas (también acepta {"ventas": [...]}).
    Solo valida estructura del lote; cada ítem se valida al procesarlo.
    """

    ventas = serializers.ListField(child=serializers.DictField(), allow_empty=False)

    def to_internal_value(self, data):
        if isinstance(data, list):
            data = {"ventas": data}
        return super().to_internal_value(data)

    def validate_ventas(self, value):
        if not value:
            raise serializers.ValidationError("El lote de sincronización está vacío.")
        uuids = []
        for item in value:
            uid = item.get("client_uuid")
            if uid is None:
                raise serializers.ValidationError(
                    "Cada venta debe incluir client_uuid."
                )
            uuids.append(str(uid))
        if len(uuids) != len(set(uuids)):
            raise serializers.ValidationError(
                "Hay client_uuid duplicados dentro del mismo lote."
            )
        return value


class CajaDiariaSerializer(serializers.ModelSerializer):
    usuario_cierre = CustomUserSerializer(read_only=True)
    total_general = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        read_only=True,
    )

    class Meta:
        model = CajaDiaria
        fields = (
            "id",
            "fecha",
            "total_efectivo",
            "total_tarjetas",
            "total_transferencias",
            "total_webpay",
            "total_general",
            "usuario_cierre",
            "cerrado_en",
        )
        read_only_fields = (
            "total_efectivo",
            "total_tarjetas",
            "total_transferencias",
            "total_webpay",
            "total_general",
            "usuario_cierre",
            "cerrado_en",
        )


class CajaDiariaCierreSerializer(serializers.Serializer):
    """Entrada para calcular y persistir el cierre de una fecha."""

    fecha = serializers.DateField(required=True)


class CartaProductoSerializer(serializers.ModelSerializer):
    """Catálogo público: solo campos necesarios para armar el pedido."""

    class Meta:
        model = Producto
        fields = ("id", "nombre", "descripcion", "precio", "categoria")
        read_only_fields = fields


class DetallePedidoSerializer(serializers.ModelSerializer):
    producto_nombre = serializers.CharField(source="producto.nombre", read_only=True)

    class Meta:
        model = DetallePedido
        fields = ("id", "producto", "producto_nombre", "cantidad", "subtotal", "notas")
        read_only_fields = ("id", "subtotal", "producto_nombre")


class DetallePedidoCreateSerializer(serializers.Serializer):
    producto = serializers.PrimaryKeyRelatedField(queryset=Producto.objects.all())
    cantidad = serializers.IntegerField(min_value=1)
    notas = serializers.CharField(required=False, allow_blank=True, default="")


class PedidoSerializer(serializers.ModelSerializer):
    detalles = DetallePedidoSerializer(many=True, read_only=True)
    venta_id = serializers.PrimaryKeyRelatedField(source="venta", read_only=True)

    class Meta:
        model = Pedido
        fields = (
            "id",
            "nombre_cliente",
            "telefono",
            "tipo_entrega",
            "direccion",
            "notas",
            "cobro_delivery",
            "total",
            "estado",
            "buy_order",
            "authorization_code",
            "venta_id",
            "detalles",
            "creado_en",
            "actualizado_en",
        )
        read_only_fields = fields


class PedidoCreateSerializer(serializers.Serializer):
    """Alta pública: el servidor fija precios, delivery y total."""

    nombre_cliente = serializers.CharField(max_length=120)
    telefono = serializers.CharField(max_length=30)
    tipo_entrega = serializers.ChoiceField(choices=Venta.TipoEntrega.choices)
    direccion = serializers.CharField(
        max_length=255, required=False, allow_blank=True, default=""
    )
    notas = serializers.CharField(required=False, allow_blank=True, default="")
    detalles = DetallePedidoCreateSerializer(many=True)

    def validate_nombre_cliente(self, value):
        nombre = (value or "").strip()
        if len(nombre) < 2:
            raise serializers.ValidationError("Indique el nombre del cliente.")
        return nombre

    def validate_telefono(self, value):
        tel = (value or "").strip()
        if len(tel) < 8:
            raise serializers.ValidationError("Indique un teléfono válido.")
        return tel

    def validate_detalles(self, value):
        if not value:
            raise serializers.ValidationError("El pedido debe incluir al menos un ítem.")
        return value

    def validate(self, attrs):
        tipo = attrs.get("tipo_entrega")
        direccion = (attrs.get("direccion") or "").strip()
        if tipo == Venta.TipoEntrega.DELIVERY and not direccion:
            raise serializers.ValidationError(
                {"direccion": "La dirección es obligatoria para delivery."}
            )
        if tipo == Venta.TipoEntrega.RETIRO:
            attrs["direccion"] = ""
        else:
            attrs["direccion"] = direccion

        if dia_ya_cerrado(timezone.now()):
            raise serializers.ValidationError(
                {
                    "detail": (
                        "No se pueden recibir pedidos: la caja del día ya está cerrada."
                    )
                }
            )

        ids = {item["producto"].pk for item in attrs["detalles"]}
        productos = {
            p.pk: p
            for p in Producto.objects.filter(pk__in=ids, estado=Producto.Estado.ACTIVO)
        }
        for item in attrs["detalles"]:
            producto = productos.get(item["producto"].pk)
            if producto is None:
                raise serializers.ValidationError(
                    {
                        "detalles": (
                            f"El producto '{item['producto'].nombre}' no está disponible."
                        )
                    }
                )
        attrs["_productos"] = productos
        return attrs
