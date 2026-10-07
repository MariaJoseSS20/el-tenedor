from decimal import Decimal, ROUND_HALF_UP

from django import forms
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import (
    CajaDiaria,
    CustomUser,
    DetallePedido,
    DetalleVenta,
    HorarioPedidosWeb,
    Inventario,
    Pedido,
    Producto,
    Venta,
    ZonaDelivery,
)


def pesos(value):
    """Mismo formato que la página: $7.000, sin decimales."""
    if value is None or value == "":
        return "—"
    n = int(Decimal(value).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    signo = "-" if n < 0 else ""
    return f"{signo}${abs(n):,}".replace(",", ".")


class EnteroPesosWidget(forms.NumberInput):
    """El formulario muestra 7000, no 7000.00."""

    def format_value(self, value):
        if value in (None, ""):
            return None
        n = int(Decimal(str(value)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        return str(n)


class MontosMixin:
    def formfield_for_dbfield(self, db_field, request, **kwargs):
        if getattr(db_field, "decimal_places", None):
            kwargs.setdefault("widget", EnteroPesosWidget(attrs={"step": "1"}))
        return super().formfield_for_dbfield(db_field, request, **kwargs)


@admin.register(CustomUser)
class CustomUserAdmin(UserAdmin):
    list_display = ("username", "email", "rol", "is_staff", "is_active")
    list_filter = ("rol", "is_staff", "is_active")
    fieldsets = UserAdmin.fieldsets + (
        ("Rol El Tenedor", {"fields": ("rol",)}),
    )
    add_fieldsets = UserAdmin.add_fieldsets + (
        ("Rol El Tenedor", {"fields": ("rol",)}),
    )


class DetalleVentaInline(MontosMixin, admin.TabularInline):
    model = DetalleVenta
    extra = 0
    fields = ("producto", "cantidad", "subtotal_pesos", "notas")
    readonly_fields = ("subtotal_pesos",)

    @admin.display(description="Subtotal")
    def subtotal_pesos(self, obj):
        if not obj or not obj.pk:
            return "—"
        return pesos(obj.subtotal)


class DetallePedidoInline(MontosMixin, admin.TabularInline):
    model = DetallePedido
    extra = 0
    fields = ("producto", "cantidad", "subtotal_pesos", "notas")
    readonly_fields = ("subtotal_pesos",)

    @admin.display(description="Subtotal")
    def subtotal_pesos(self, obj):
        if not obj or not obj.pk:
            return "—"
        return pesos(obj.subtotal)


@admin.register(ZonaDelivery)
class ZonaDeliveryAdmin(MontosMixin, admin.ModelAdmin):
    list_display = ("nombre", "descripcion", "precio_pesos")

    @admin.display(description="Precio", ordering="precio")
    def precio_pesos(self, obj):
        return pesos(obj.precio)

    search_fields = ("nombre", "descripcion")


@admin.register(HorarioPedidosWeb)
class HorarioPedidosWebAdmin(admin.ModelAdmin):
    list_display = (
        "habilitado",
        "turno1_activo",
        "turno1_inicio",
        "turno1_fin",
        "turno2_activo",
        "turno2_inicio",
        "turno2_fin",
        "actualizado_en",
    )
    fieldsets = (
        ("Estado", {"fields": ("habilitado",)}),
        (
            "Días",
            {
                "fields": (
                    "lunes",
                    "martes",
                    "miercoles",
                    "jueves",
                    "viernes",
                    "sabado",
                    "domingo",
                )
            },
        ),
        ("Turno 1", {"fields": ("turno1_activo", "turno1_inicio", "turno1_fin")}),
        ("Turno 2", {"fields": ("turno2_activo", "turno2_inicio", "turno2_fin")}),
        ("Textos", {"fields": ("texto_horario", "mensaje_cerrado")}),
        ("Meta", {"fields": ("actualizado_en",)}),
    )
    readonly_fields = ("actualizado_en",)

    def has_add_permission(self, request):
        return not HorarioPedidosWeb.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(Producto)
class ProductoAdmin(MontosMixin, admin.ModelAdmin):
    list_display = ("nombre", "categoria", "precio_pesos", "estado")
    list_filter = ("categoria", "estado")
    search_fields = ("nombre", "codigo_barras")

    @admin.display(description="Precio", ordering="precio")
    def precio_pesos(self, obj):
        return pesos(obj.precio)


@admin.register(Inventario)
class InventarioAdmin(admin.ModelAdmin):
    list_display = ("nombre", "cantidad", "ultima_actualizacion")
    search_fields = ("nombre",)
    readonly_fields = ("ultima_actualizacion",)


@admin.register(Venta)
class VentaAdmin(MontosMixin, admin.ModelAdmin):
    list_display = (
        "id",
        "fecha_hora",
        "cajero",
        "total_pesos",
        "metodo_pago",
        "tipo_entrega",
        "estado",
        "client_uuid",
    )
    list_filter = ("estado", "metodo_pago", "tipo_entrega")
    search_fields = ("client_uuid", "cajero__username")
    inlines = [DetalleVentaInline]
    exclude = ("total",)
    readonly_fields = ("total_pesos", "creado_en")

    @admin.display(description="Total", ordering="total")
    def total_pesos(self, obj):
        return pesos(obj.total)

    def has_delete_permission(self, request, obj=None):
        return False

    def save_related(self, request, form, formsets, change):
        super().save_related(request, form, formsets, change)
        form.instance.recalcular_total()


@admin.register(Pedido)
class PedidoAdmin(MontosMixin, admin.ModelAdmin):
    list_display = (
        "id",
        "nombre_cliente",
        "telefono",
        "tipo_entrega",
        "total_pesos",
        "estado",
        "creado_en",
    )

    @admin.display(description="Total", ordering="total")
    def total_pesos(self, obj):
        return pesos(obj.total)
    list_filter = ("estado", "tipo_entrega")
    search_fields = ("nombre_cliente", "telefono", "buy_order", "webpay_token")
    inlines = [DetallePedidoInline]
    exclude = ("total",)
    readonly_fields = (
        "total_pesos",
        "buy_order",
        "webpay_token",
        "authorization_code",
        "venta",
        "creado_en",
        "actualizado_en",
    )


@admin.register(CajaDiaria)
class CajaDiariaAdmin(admin.ModelAdmin):
    list_display = (
        "fecha",
        "efectivo_pesos",
        "tarjetas_pesos",
        "debito_pesos",
        "credito_pesos",
        "transferencias_pesos",
        "webpay_pesos",
        "usuario_cierre",
        "cerrado_en",
    )
    exclude = (
        "total_efectivo",
        "total_tarjetas",
        "total_debito",
        "total_credito",
        "total_transferencias",
        "total_webpay",
    )
    readonly_fields = (
        "efectivo_pesos",
        "tarjetas_pesos",
        "debito_pesos",
        "credito_pesos",
        "transferencias_pesos",
        "webpay_pesos",
        "cerrado_en",
    )

    @admin.display(description="Efectivo", ordering="total_efectivo")
    def efectivo_pesos(self, obj):
        return pesos(obj.total_efectivo)

    @admin.display(description="Tarjetas", ordering="total_tarjetas")
    def tarjetas_pesos(self, obj):
        return pesos(obj.total_tarjetas)

    @admin.display(description="Débito", ordering="total_debito")
    def debito_pesos(self, obj):
        return pesos(obj.total_debito)

    @admin.display(description="Crédito", ordering="total_credito")
    def credito_pesos(self, obj):
        return pesos(obj.total_credito)

    @admin.display(description="Transferencias", ordering="total_transferencias")
    def transferencias_pesos(self, obj):
        return pesos(obj.total_transferencias)

    @admin.display(description="Webpay", ordering="total_webpay")
    def webpay_pesos(self, obj):
        return pesos(obj.total_webpay)
