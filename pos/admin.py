from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import CajaDiaria, CustomUser, DetalleVenta, Inventario, Producto, Venta


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


@admin.register(Producto)
class ProductoAdmin(admin.ModelAdmin):
    list_display = ("nombre", "categoria", "precio", "estado")
    list_filter = ("categoria", "estado")
    search_fields = ("nombre", "codigo_barras")


@admin.register(Inventario)
class InventarioAdmin(admin.ModelAdmin):
    list_display = ("producto", "ultima_actualizacion")
    search_fields = ("producto__nombre",)
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


@admin.register(CajaDiaria)
class CajaDiariaAdmin(admin.ModelAdmin):
    list_display = (
        "fecha",
        "total_efectivo",
        "total_tarjetas",
        "total_transferencias",
        "usuario_cierre",
        "cerrado_en",
    )
    readonly_fields = (
        "total_efectivo",
        "total_tarjetas",
        "total_transferencias",
        "cerrado_en",
    )
