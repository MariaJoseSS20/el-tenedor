"""
Serializers DRF — El Tenedor.

Incluye Venta anidada con DetalleVenta y el payload de sync offline masivo.
Sin control de stock: las ventas no descuentan cantidades de inventario.
"""

from decimal import Decimal

from django.db import transaction
from rest_framework import serializers

from .models import (
    CajaDiaria,
    CustomUser,
    DetalleVenta,
    Inventario,
    Producto,
    Venta,
)


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
        if Inventario.objects.filter(producto=producto).exists():
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


class DetalleVentaSerializer(serializers.ModelSerializer):
    producto_nombre = serializers.CharField(source="producto.nombre", read_only=True)

    class Meta:
        model = DetalleVenta
        fields = ("id", "producto", "producto_nombre", "cantidad", "subtotal", "notas")
        read_only_fields = ("id", "subtotal")


class VentaSerializer(serializers.ModelSerializer):
    """
    Serializer anidado: crea Venta + DetalleVenta en una sola petición.
    El cajero se toma del usuario autenticado (trazabilidad).
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
        read_only_fields = ("id", "total", "estado", "creado_en", "cajero", "cajero_id")

    def validate_detalles(self, value):
        if not value:
            raise serializers.ValidationError("La venta debe incluir al menos un detalle.")
        return value

    def validate(self, attrs):
        tipo = attrs.get("tipo_entrega")
        cobro = attrs.get("cobro_delivery", Decimal("0.00"))
        if tipo == Venta.TipoEntrega.RETIRO and cobro and cobro > 0:
            raise serializers.ValidationError(
                {"cobro_delivery": "Retiro en local no debe incluir cobro de delivery."}
            )
        if tipo == Venta.TipoEntrega.DELIVERY and (cobro is None or cobro < 0):
            raise serializers.ValidationError(
                {"cobro_delivery": "Indique un cobro de delivery válido (>= 0)."}
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

    @transaction.atomic
    def create(self, validated_data):
        detalles_data = validated_data.pop("detalles")
        request = self.context["request"]
        validated_data["cajero"] = request.user
        validated_data["estado"] = Venta.Estado.COMPLETADA

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
    Ítem del lote offline enviado por la PWA desde IndexedDB.
    """

    client_uuid = serializers.UUIDField(required=True)
    fecha_hora = serializers.DateTimeField(required=False)
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
    Todo el lote se procesa dentro de transaction.atomic en la vista.
    """

    ventas = SyncVentaItemSerializer(many=True)

    def to_internal_value(self, data):
        if isinstance(data, list):
            data = {"ventas": data}
        return super().to_internal_value(data)

    def validate_ventas(self, value):
        if not value:
            raise serializers.ValidationError("El lote de sincronización está vacío.")
        uuids = [str(v["client_uuid"]) for v in value]
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
            "total_general",
            "usuario_cierre",
            "cerrado_en",
        )
        read_only_fields = (
            "total_efectivo",
            "total_tarjetas",
            "total_transferencias",
            "total_general",
            "usuario_cierre",
            "cerrado_en",
        )


class CajaDiariaCierreSerializer(serializers.Serializer):
    """Entrada para calcular y persistir el cierre de una fecha."""

    fecha = serializers.DateField(required=True)
