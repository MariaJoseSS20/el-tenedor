"""
URLs del proyecto config — El Tenedor.
"""

from django.contrib import admin
from django.urls import include, path

from config.auth_views import (
    ThrottledTokenObtainPairView,
    ThrottledTokenRefreshView,
)

urlpatterns = [
    path("admin/", admin.site.urls),
    # Autenticación JWT para la PWA (con rate limit de login)
    path("api/token/", ThrottledTokenObtainPairView.as_view(), name="token_obtain_pair"),
    path(
        "api/token/refresh/",
        ThrottledTokenRefreshView.as_view(),
        name="token_refresh",
    ),
    # API del POS
    path("api/", include("pos.urls")),
]
