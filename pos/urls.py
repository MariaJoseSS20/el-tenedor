"""
Rutas de la app POS — El Tenedor.
"""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    CajaDiariaViewSet,
    InventarioViewSet,
    MeView,
    ProductoViewSet,
    ReporteDiarioView,
    SyncVentasView,
    VentaViewSet,
)

router = DefaultRouter()
router.register(r"productos", ProductoViewSet, basename="producto")
router.register(r"inventario", InventarioViewSet, basename="inventario")
router.register(r"ventas", VentaViewSet, basename="venta")
router.register(r"caja-diaria", CajaDiariaViewSet, basename="caja-diaria")

urlpatterns = [
    path("me/", MeView.as_view(), name="me"),
    # Sync offline: recibe un array de ventas guardadas en IndexedDB.
    path("sync-ventas/", SyncVentasView.as_view(), name="sync-ventas"),
    path("reportes/diario/", ReporteDiarioView.as_view(), name="reporte-diario"),
    path("", include(router.urls)),
]
