"""
URLs del proyecto config — El Tenedor.
"""

from django.contrib import admin
from django.urls import include, path

from config.auth_views import (
    RegistroView,
    ThrottledTokenObtainPairView,
    ThrottledTokenRefreshView,
)

def api_patterns():
    """Rutas de la API. Se montan en /api/ y en /api/v1/."""
    return [
        path("token/", ThrottledTokenObtainPairView.as_view(), name="token_obtain_pair"),
        path(
            "token/refresh/",
            ThrottledTokenRefreshView.as_view(),
            name="token_refresh",
        ),
        path("registro/", RegistroView.as_view(), name="registro"),
        path("", include("pos.urls")),
    ]


urlpatterns = [
    path("admin/", admin.site.urls),
    # /api/ lo sigue usando la PWA ya publicada.
    path("api/", include(api_patterns())),
    # Prefijo versionado que pide la pauta: /api/v1/recursos/
    path("api/v1/", include(api_patterns())),
]
