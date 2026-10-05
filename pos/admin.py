from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import (
    CajaDiaria,
    CustomUser,
    DetallePedido,
    DetalleVenta,
    Inventario,
    Pedido,
    Producto,
    Venta,
    ZonaDelivery,
)


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


class DetalleVentaInline(admin.TabularInline):
    model = DetalleVenta
    extra = 0
    readonly_fields = ("subtotal",)


class DetallePedidoInline(admin.TabularInline):
    model = DetallePedido
    extra = 0
    readonly_fields = ("subtotal",)


@admin.register(ZonaDelivery)
class ZonaDeliveryAdmin(admin.ModelAdmin):
    list_display = ("nombre", "descripcion", "precio")
    search_fields = ("nombre", "descripcion")
    list_editable = ("precio",)


@admin.register(Producto)
class ProductoAdmin(admin.ModelAdmin):
    list_display = ("nombre", "categoria", "precio", "estado")
    list_filter = ("categoria", "estado")
    search_fields = ("nombre", "codigo_barras")


@admin.register(Inventario)
class InventarioAdmin(admin.ModelAdmin):
    list_display = ("nombre", "cantidad", "ultima_actualizacion")
    search_fields = ("nombre",)
    readonly_fields = ("ultima_actualizacion",)


@admin.register(Venta)
class VentaAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "fecha_hora",
        "cajero",
        "total",
        "metodo_pago",
        "tipo_entrega",
        "estado",
        "client_uuid",
    )
    list_filter = ("estado", "metodo_pago", "tipo_entrega")
    search_fields = ("client_uuid", "cajero__username")
    inlines = [DetalleVentaInline]
    readonly_fields = ("total", "creado_en")

    def has_delete_permission(self, request, obj=None):
        return False

    def save_related(self, request, form, formsets, change):
        super().save_related(request, form, formsets, change)
        form.instance.recalcular_total()


@admin.register(Pedido)
class PedidoAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "nombre_cliente",
        "telefono",
        "tipo_entrega",
        "total",
        "estado",
        "creado_en",
    )
    list_filter = ("estado", "tipo_entrega")
    search_fields = ("nombre_cliente", "telefono", "buy_order", "webpay_token")
    inlines = [DetallePedidoInline]
    readonly_fields = (
        "total",
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
        "total_efectivo",
        "total_tarjetas",
        "total_transferencias",
        "total_webpay",
        "usuario_cierre",
        "cerrado_en",
    )
    readonly_fields = (
        "total_efectivo",
        "total_tarjetas",
        "total_transferencias",
        "total_webpay",
        "cerrado_en",
    )
