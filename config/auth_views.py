"""
Vistas JWT con throttling estricto en login/refresh (anti fuerza bruta).
Registro público crea solo cajeros (no se puede auto-asignar administrador).
"""

from django.contrib.auth.password_validation import validate_password
from django.db import IntegrityError
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from pos.models import CustomUser
from pos.serializers import CustomUserSerializer


class LoginRateThrottle(AnonRateThrottle):
    """Límite por IP para obtención y refresco de tokens."""

    scope = "login"


class ThrottledTokenObtainPairView(TokenObtainPairView):
    throttle_classes = [LoginRateThrottle]


class ThrottledTokenRefreshView(TokenRefreshView):
    throttle_classes = [LoginRateThrottle]


class RegistroSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(write_only=True, min_length=8)
    password_confirm = serializers.CharField(write_only=True)
    first_name = serializers.CharField(
        max_length=150, required=False, allow_blank=True, default=""
    )
    last_name = serializers.CharField(
        max_length=150, required=False, allow_blank=True, default=""
    )
    email = serializers.EmailField(required=False, allow_blank=True, default="")

    def validate_username(self, value):
        username = value.strip()
        if not username:
            raise serializers.ValidationError("El usuario es obligatorio.")
        if CustomUser.objects.filter(username__iexact=username).exists():
            raise serializers.ValidationError("Ese usuario ya existe.")
        return username

    def validate(self, attrs):
        if attrs["password"] != attrs["password_confirm"]:
            raise serializers.ValidationError(
                {"password_confirm": "Las contraseñas no coinciden."}
            )
        validate_password(attrs["password"])
        return attrs

    def create(self, validated_data):
        validated_data.pop("password_confirm")
        password = validated_data.pop("password")
        # Solo cajero: el rol administrador se asigna desde el admin Django.
        user = CustomUser(
            username=validated_data["username"],
            first_name=validated_data.get("first_name", "").strip(),
            last_name=validated_data.get("last_name", "").strip(),
            email=validated_data.get("email", "").strip(),
            rol=CustomUser.Rol.CAJERO,
        )
        user.set_password(password)
        try:
            user.save()
        except IntegrityError as exc:
            raise serializers.ValidationError(
                {"username": "Ese usuario ya existe."}
            ) from exc
        return user


class RegistroView(APIView):
    """
    POST /api/registro/ — alta pública de cajero + emisión de JWT.
    Cumple login/registro de la pauta sin permitir auto-escalada a admin.
    """

    permission_classes = [AllowAny]
    throttle_classes = [LoginRateThrottle]
    authentication_classes = []

    def post(self, request):
        serializer = RegistroSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        refresh = RefreshToken.for_user(user)
        return Response(
            {
                "access": str(refresh.access_token),
                "refresh": str(refresh),
                "user": CustomUserSerializer(user).data,
            },
            status=status.HTTP_201_CREATED,
        )
