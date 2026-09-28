"""
Vistas JWT con throttling estricto en login/refresh (anti fuerza bruta).
"""

from rest_framework.throttling import AnonRateThrottle
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView


class LoginRateThrottle(AnonRateThrottle):
    """Límite por IP para obtención y refresco de tokens."""

    scope = "login"


class ThrottledTokenObtainPairView(TokenObtainPairView):
    throttle_classes = [LoginRateThrottle]


class ThrottledTokenRefreshView(TokenRefreshView):
    throttle_classes = [LoginRateThrottle]
