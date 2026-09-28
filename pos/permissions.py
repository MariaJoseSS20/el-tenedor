"""
Permisos por rol — El Tenedor.

Cajero:
  - GET productos / inventario
  - POST ventas y sync offline
  - No puede modificar, borrar ni anular ventas
  - No gestiona inventario, usuarios ni cierre de caja

Administrador:
  - CRUD de catálogo / inventario / caja
  - Único que puede anular ventas (no se borran)
"""

from rest_framework.permissions import SAFE_METHODS, BasePermission


class EsAdministrador(BasePermission):
    """Solo usuarios con rol Administrador."""

    message = "Solo el Administrador puede realizar esta acción."

    def has_permission(self, request, view):
        user = request.user
        return bool(
            user
            and user.is_authenticated
            and getattr(user, "es_administrador", False)
        )


class EsCajeroOAdministrador(BasePermission):
    """Cualquier usuario autenticado del POS (cajero o admin)."""

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated)


class LecturaTodosEscrituraAdmin(BasePermission):
    """
    GET permitido a Cajero y Administrador.
    POST/PUT/PATCH/DELETE solo Administrador.
    """

    message = "Los cajeros solo pueden consultar; la gestión es exclusiva del Administrador."

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        if request.method in SAFE_METHODS:
            return True
        return getattr(user, "es_administrador", False)


class PermisoVentas(BasePermission):
    """
    - Listar / recuperar: autenticados (admin ve historial completo; cajero también
      puede listar las propias según la vista).
    - Crear (POST): cajero y administrador.
    - Anular (PATCH): solo administrador.
    """

    message = "No tiene permiso para esta operación sobre ventas."

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False

        if request.method in SAFE_METHODS:
            return True

        if request.method == "POST":
            # Alta de venta o acciones custom de creación
            return True

        # PUT / PATCH → solo admin (anulación)
        return getattr(user, "es_administrador", False)

    def has_object_permission(self, request, view, obj):
        user = request.user
        if request.method in SAFE_METHODS:
            if getattr(user, "es_administrador", False):
                return True
            # Cajero solo ve sus propias ventas
            return obj.cajero_id == user.id

        # Anular: solo admin
        return getattr(user, "es_administrador", False)
