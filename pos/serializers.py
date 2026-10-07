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
    PagoVenta,
    Pedido,
    Producto,
    Venta,
    HorarioPedidosWeb,
    ZonaDelivery,
)
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
    class Meta:
        model = Inventario
        fields = (
            "id",
            "nombre",
            "cantidad",
            "notas",
            "ultima_actualizacion",
        )
        read_only_fields = ("ultima_actualizacion",)
    def validate_nombre(self, value):
        nombre = value.strip()
        if not nombre:
            raise serializers.ValidationError(
                "El nombre del empaque no puede estar vacío."
            )
        return nombre
class ProductoSerializer(serializers.ModelSerializer):
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
class PagoVentaSerializer(serializers.ModelSerializer):
    """Pago individual asociado a una venta."""
    class Meta:
        model = PagoVenta
        fields = ("id", "metodo", "monto")
        read_only_fields = ("id",)
    def validate_monto(self, value):
        if value is None or value <= 0:
            raise serializers.ValidationError("El monto del pago debe ser mayor que 0.")
        return value
class VentaSerializer(serializers.ModelSerializer):
    """
    Serializer anidado: crea Venta + DetalleVenta + PagoVenta.
    El cajero se toma del usuario autenticado (trazabilidad).
    fecha_hora es solo lectura: la fija el servidor.
    `pagos` permite registrar uno o varios medios de pago.
    `metodo_pago` se conserva temporalmente por compatibilidad con el sistema anterior.
    """
    detalles = DetalleVentaSerializer(many=True)
    pagos = PagoVentaSerializer(many=True, required=False)
    neto = serializers.SerializerMethodField()
    iva = serializers.SerializerMethodField()
    metodo_pago = serializers.ChoiceField(
        choices=Venta.MetodoPago.choices,
        required=False,
    )
    cajero = CustomUserSerializer(read_only=True)
    cajero_id = serializers.PrimaryKeyRelatedField(source="cajero", read_only=True)
    zona_delivery = serializers.PrimaryKeyRelatedField(
        queryset=ZonaDelivery.objects.all(),
        required=False,
        allow_null=True,
        write_only=True,
    )

    class Meta:
        model = Venta
        fields = (
            "id",
            "client_uuid",
            "cajero",
            "cajero_id",
            "fecha_hora",
            "neto",
            "iva",
            "total",
            "metodo_pago",
            "tipo_entrega",
            "cobro_delivery",
            "zona_delivery",
            "estado",
            "notas",
            "detalles",
            "pagos",
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
        
    def get_neto(self, obj):
        total = Decimal(obj.total or 0)
        return (total / Decimal("1.19")).quantize(Decimal("0.01"))

    def get_iva(self, obj):
        total = Decimal(obj.total or 0)
        neto = (total / Decimal("1.19")).quantize(Decimal("0.01"))
        return (total - neto).quantize(Decimal("0.01"))
    
    def validate_detalles(self, value):
        if not value:
            raise serializers.ValidationError("La venta debe incluir al menos un detalle.")
        return value
    def validate_pagos(self, value):
        if not value:
            raise serializers.ValidationError("La lista de pagos no puede estar vacía.")
        return value
    def validate(self, attrs):
        tipo = attrs.get("tipo_entrega")
        zona = attrs.pop("zona_delivery", None)
        if tipo == Venta.TipoEntrega.DELIVERY:
            if zona is None:
                raise serializers.ValidationError(
                    {"zona_delivery": "Elige una zona de delivery."}
                )
            attrs["cobro_delivery"] = zona.precio
        else:
            attrs["cobro_delivery"] = Decimal("0.00")
        validar_entrega_y_cobro(tipo, attrs["cobro_delivery"])
        if not attrs.get("pagos") and not attrs.get("metodo_pago"):
            raise serializers.ValidationError(
                {"pagos": "Indique al menos un pago para la venta."}
            )
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
    @staticmethod
    def _metodo_legacy_desde_pagos(pagos_data):
        """
        Mantiene Venta.metodo_pago mientras el resto del proyecto migra a PagoVenta.
        Débito/crédito se representan temporalmente como 'tarjeta' en el campo antiguo.
        """
        metodos = {p["metodo"] for p in pagos_data}
        if PagoVenta.MetodoPago.WEBPAY in metodos:
            return Venta.MetodoPago.WEBPAY
        if (
            PagoVenta.MetodoPago.DEBITO in metodos
            or PagoVenta.MetodoPago.CREDITO in metodos
        ):
            return Venta.MetodoPago.TARJETA
        if PagoVenta.MetodoPago.EFECTIVO in metodos:
            return Venta.MetodoPago.EFECTIVO
        return Venta.MetodoPago.TRANSFERENCIA
    @transaction.atomic
    def create(self, validated_data):
        detalles_data = validated_data.pop("detalles")
        pagos_data = validated_data.pop("pagos", None)
        metodo_pago_legacy = validated_data.get("metodo_pago")
        if pagos_data:
            validated_data["metodo_pago"] = self._metodo_legacy_desde_pagos(pagos_data)
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
        venta.total = (total_detalles + cobro).quantize(Decimal("0.01"))
        venta.save(update_fields=["total"])
        if pagos_data:
            total_pagos = sum(
                (pago["monto"] for pago in pagos_data),
                Decimal("0.00"),
            ).quantize(Decimal("0.01"))
            if total_pagos != venta.total:
                raise serializers.ValidationError(
                    {
                        "pagos": (
                            f"La suma de los pagos ({total_pagos}) debe coincidir "
                            f"con el total de la venta ({venta.total})."
                        )
                    }
                )
            for pago in pagos_data:
                PagoVenta.objects.create(venta=venta, **pago)
        elif metodo_pago_legacy in (
            Venta.MetodoPago.EFECTIVO,
            Venta.MetodoPago.TRANSFERENCIA,
            Venta.MetodoPago.WEBPAY,
        ):
            PagoVenta.objects.create(
                venta=venta,
                metodo=metodo_pago_legacy,
                monto=venta.total,
            )
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
            "total_debito",
            "total_credito",
            "total_transferencias",
            "total_webpay",
            "total_general",
            "usuario_cierre",
            "cerrado_en",
        )
        read_only_fields = (
            "total_efectivo",
            "total_tarjetas",
            "total_debito",
            "total_credito",
            "total_transferencias",
            "total_webpay",
            "total_general",
            "usuario_cierre",
            "cerrado_en",
        )
class CajaDiariaCierreSerializer(serializers.Serializer):
    """Entrada para calcular y persistir el cierre de una fecha."""
    fecha = serializers.DateField(required=True)


class HorarioPedidosWebSerializer(serializers.ModelSerializer):
    class Meta:
        model = HorarioPedidosWeb
        fields = (
            "habilitado",
            "lunes",
            "martes",
            "miercoles",
            "jueves",
            "viernes",
            "sabado",
            "domingo",
            "turno1_activo",
            "turno1_inicio",
            "turno1_fin",
            "turno2_activo",
            "turno2_inicio",
            "turno2_fin",
            "texto_horario",
            "mensaje_cerrado",
            "actualizado_en",
        )
        read_only_fields = ("actualizado_en",)

    def validate(self, attrs):
        instance = getattr(self, "instance", None)

        def val(name, default=None):
            if name in attrs:
                return attrs[name]
            if instance is not None:
                return getattr(instance, name)
            return default

        t1_on = val("turno1_activo", True)
        t2_on = val("turno2_activo", True)
        if not t1_on and not t2_on:
            raise serializers.ValidationError(
                "Activa al menos un turno (1 o 2) para recibir pedidos."
            )
        if t1_on:
            t1i, t1f = val("turno1_inicio"), val("turno1_fin")
            if t1i and t1f and t1i >= t1f:
                raise serializers.ValidationError(
                    {
                        "turno1_fin": "La hora de fin del turno 1 debe ser posterior al inicio."
                    }
                )
        if t2_on:
            t2i, t2f = val("turno2_inicio"), val("turno2_fin")
            if t2i and t2f and t2i >= t2f:
                raise serializers.ValidationError(
                    {
                        "turno2_fin": "La hora de fin del turno 2 debe ser posterior al inicio."
                    }
                )
        return attrs


class ZonaDeliverySerializer(serializers.ModelSerializer):
    class Meta:
        model = ZonaDelivery
        fields = (
            "id",
            "nombre",
            "descripcion",
            "precio",
            "creado_en",
            "actualizado_en",
        )
        read_only_fields = ("creado_en", "actualizado_en")

    def validate_nombre(self, value):
        nombre = (value or "").strip()
        if len(nombre) < 2:
            raise serializers.ValidationError("Indique un nombre de al menos 2 caracteres.")
        qs = ZonaDelivery.objects.filter(nombre__iexact=nombre)
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("Ya existe una zona con ese nombre.")
        return nombre

    def validate_descripcion(self, value):
        return (value or "").strip()

    def validate_precio(self, value):
        if value is None or value < 0:
            raise serializers.ValidationError("El precio debe ser 0 o mayor.")
        return value


class ZonaDeliveryPublicaSerializer(serializers.ModelSerializer):
    class Meta:
        model = ZonaDelivery
        fields = ("id", "nombre", "descripcion", "precio")
        read_only_fields = fields


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
            "zona_delivery",
            "zona_nombre",
            "zona_descripcion",
            "total",
            "estado",
            "metodo_pago",
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
    zona_delivery = serializers.PrimaryKeyRelatedField(
        queryset=ZonaDelivery.objects.all(),
        required=False,
        allow_null=True,
    )
    detalles = DetallePedidoCreateSerializer(many=True)
    metodo_pago = serializers.ChoiceField(
        choices=Pedido.MetodoPago.choices,
        required=False,
        default=Pedido.MetodoPago.WEBPAY,
    )
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
        zona = attrs.get("zona_delivery")
        if tipo == Venta.TipoEntrega.DELIVERY:
            if zona is None:
                raise serializers.ValidationError(
                    {"zona_delivery": "Elige una zona de delivery."}
                )
            attrs["_cobro_delivery"] = zona.precio
        else:
            attrs["zona_delivery"] = None
            attrs["_cobro_delivery"] = Decimal("0.00")
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
