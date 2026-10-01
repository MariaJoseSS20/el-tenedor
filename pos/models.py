"""
Modelos del POS El Tenedor.

Reglas clave:
- Cada venta queda trazada al cajero autenticado.
- Inventario 1:1 con Producto (catálogo de ítems inventariables).
  El control de cantidades/stock se definirá en una iteración posterior.
- client_uuid en Venta evita duplicados al reintentar sync offline.
"""

from decimal import Decimal

from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone


class CustomUser(AbstractUser):
    """Usuario del sistema con rol de negocio (Administrador o Cajero)."""

    class Rol(models.TextChoices):
        ADMINISTRADOR = "administrador", "Administrador"
        CAJERO = "cajero", "Cajero"

    rol = models.CharField(
        max_length=20,
        choices=Rol.choices,
        default=Rol.CAJERO,
        help_text="Define permisos: Cajero (ventas) vs Administrador (CRUD total).",
    )

    class Meta:
        verbose_name = "usuario"
        verbose_name_plural = "usuarios"

    def __str__(self):
        return f"{self.username} ({self.get_rol_display()})"

    @property
    def es_administrador(self):
        return self.rol == self.Rol.ADMINISTRADOR

    @property
    def es_cajero(self):
        return self.rol == self.Rol.CAJERO


class Producto(models.Model):
    """Producto o insumo vendible del menú (sushi, shawarma, etc.)."""

    class Categoria(models.TextChoices):
        CEVICHES = "ceviches", "Ceviches"
        PICOTEO = "picoteo", "Algo para picar"
        PAPAS = "papas", "Papas fritas"
        SHAWARMAS = "shawarmas", "Shawarmas"
        TABLAS = "tablas", "Tablas"
        GOHAN = "gohan", "Gohan"
        AGREGADOS = "agregados", "Agregados"
        # Compatibilidad con datos antiguos
        SUSHI = "sushi", "Sushi"
        SHAWARMA = "shawarma", "Shawarma"
        BEBESTIBLES = "bebestibles", "Bebestibles"

    class Estado(models.TextChoices):
        ACTIVO = "activo", "Activo"
        INACTIVO = "inactivo", "Inactivo"

    nombre = models.CharField(max_length=150)
    descripcion = models.TextField(blank=True)
    precio = models.DecimalField(max_digits=10, decimal_places=2)
    categoria = models.CharField(max_length=20, choices=Categoria.choices)
    codigo_barras = models.CharField(
        max_length=64,
        blank=True,
        null=True,
        unique=True,
        help_text="Opcional; el MVP usa ingreso manual (sin escáner).",
    )
    estado = models.CharField(
        max_length=10,
        choices=Estado.choices,
        default=Estado.ACTIVO,
    )
    creado_en = models.DateTimeField(auto_now_add=True)
    actualizado_en = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["nombre"]
        verbose_name = "producto"
        verbose_name_plural = "productos"

    def __str__(self):
        return f"{self.nombre} (${self.precio})"


class Inventario(models.Model):
    """
    Registro de inventario 1:1 asociado a un Producto.
    Sin cantidades por ahora: el control de stock se implementará aparte.
    """

    producto = models.OneToOneField(
        Producto,
        on_delete=models.CASCADE,
        related_name="inventario",
    )
    notas = models.TextField(
        blank=True,
        help_text="Observaciones internas del ítem en inventario.",
    )
    ultima_actualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "inventario"
        verbose_name_plural = "inventarios"

    def __str__(self):
        return f"Inventario: {self.producto.nombre}"


class Venta(models.Model):
    """Cabecera de una venta / pedido del local."""

    class MetodoPago(models.TextChoices):
        EFECTIVO = "efectivo", "Efectivo"
        TARJETA = "tarjeta", "Tarjeta"
        TRANSFERENCIA = "transferencia", "Transferencia"
        WEBPAY = "webpay", "Webpay"

    class TipoEntrega(models.TextChoices):
        RETIRO = "retiro", "Retiro"
        DELIVERY = "delivery", "Delivery"

    class Estado(models.TextChoices):
        COMPLETADA = "completada", "Completada"
        ANULADA = "anulada", "Anulada"

    client_uuid = models.UUIDField(
        unique=True,
        null=True,
        blank=True,
        help_text="Identificador local de la PWA; evita ventas duplicadas al sincronizar.",
    )
    cajero = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="ventas",
    )
    fecha_hora = models.DateTimeField(default=timezone.now)
    total = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    metodo_pago = models.CharField(max_length=20, choices=MetodoPago.choices)
    tipo_entrega = models.CharField(max_length=20, choices=TipoEntrega.choices)
    cobro_delivery = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    estado = models.CharField(
        max_length=20,
        choices=Estado.choices,
        default=Estado.COMPLETADA,
    )
    notas = models.TextField(
        blank=True,
        default="",
        help_text="Nota general del pedido (cliente / cocina).",
    )
    creado_en = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-fecha_hora"]
        verbose_name = "venta"
        verbose_name_plural = "ventas"

    def __str__(self):
        return f"Venta #{self.pk} — {self.total} ({self.get_estado_display()})"

    def recalcular_total(self):
        """Suma subtotales de detalle + cobro delivery."""
        subtotal_detalles = sum(
            (d.subtotal for d in self.detalles.all()),
            Decimal("0.00"),
        )
        self.total = subtotal_detalles + (self.cobro_delivery or Decimal("0.00"))
        self.save(update_fields=["total"])


class DetalleVenta(models.Model):
    """Línea de producto dentro de una venta."""

    venta = models.ForeignKey(
        Venta,
        on_delete=models.CASCADE,
        related_name="detalles",
    )
    producto = models.ForeignKey(
        Producto,
        on_delete=models.PROTECT,
        related_name="detalles_venta",
    )
    cantidad = models.PositiveIntegerField()
    subtotal = models.DecimalField(max_digits=12, decimal_places=2)
    notas = models.TextField(
        blank=True,
        help_text="Ej. rolls incluidos/quitados en una tabla personalizada.",
    )

    class Meta:
        verbose_name = "detalle de venta"
        verbose_name_plural = "detalles de venta"

    def __str__(self):
        return f"{self.cantidad} x {self.producto.nombre}"

    def clean(self):
        if self.cantidad < 1:
            raise ValidationError({"cantidad": "La cantidad debe ser al menos 1."})


class CajaDiaria(models.Model):
    """
    Cierre de caja del día.
    Los totales se calculan a partir de ventas Completadas (no se editan a mano).
    """

    fecha = models.DateField(unique=True)
    total_efectivo = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    total_tarjetas = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    total_transferencias = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    total_webpay = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    usuario_cierre = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="cierres_caja",
    )
    cerrado_en = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-fecha"]
        verbose_name = "caja diaria"
        verbose_name_plural = "cajas diarias"

    def __str__(self):
        return (
            f"Caja {self.fecha} — E:{self.total_efectivo} "
            f"T:{self.total_tarjetas} Tr:{self.total_transferencias} "
            f"W:{self.total_webpay}"
        )

    @property
    def total_general(self):
        return (
            self.total_efectivo
            + self.total_tarjetas
            + self.total_transferencias
            + self.total_webpay
        )


class Pedido(models.Model):
    """
    Pedido web del cliente. Solo llega a cocina si Webpay autoriza el pago.
    """

    class Estado(models.TextChoices):
        ESPERANDO_PAGO = "esperando_pago", "Esperando pago"
        PAGADO = "pagado", "Pagado"
        RECIBIDO = "recibido", "Recibido"
        RECHAZADO = "rechazado", "Rechazado"

    nombre_cliente = models.CharField(max_length=120)
    telefono = models.CharField(max_length=30)
    tipo_entrega = models.CharField(max_length=20, choices=Venta.TipoEntrega.choices)
    direccion = models.CharField(max_length=255, blank=True, default="")
    notas = models.TextField(blank=True, default="")
    cobro_delivery = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    total = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    estado = models.CharField(
        max_length=20,
        choices=Estado.choices,
        default=Estado.ESPERANDO_PAGO,
    )
    buy_order = models.CharField(max_length=26, unique=True)
    webpay_token = models.CharField(max_length=64, blank=True, default="", db_index=True)
    authorization_code = models.CharField(max_length=64, blank=True, default="")
    venta = models.OneToOneField(
        Venta,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="pedido_web",
    )
    creado_en = models.DateTimeField(auto_now_add=True)
    actualizado_en = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-creado_en"]
        verbose_name = "pedido web"
        verbose_name_plural = "pedidos web"

    def __str__(self):
        return f"Pedido #{self.pk} — {self.nombre_cliente} ({self.get_estado_display()})"


class DetallePedido(models.Model):
    """Línea de producto dentro de un pedido web."""

    pedido = models.ForeignKey(
        Pedido,
        on_delete=models.CASCADE,
        related_name="detalles",
    )
    producto = models.ForeignKey(
        Producto,
        on_delete=models.PROTECT,
        related_name="detalles_pedido",
    )
    cantidad = models.PositiveIntegerField()
    subtotal = models.DecimalField(max_digits=12, decimal_places=2)
    notas = models.TextField(blank=True, default="")

    class Meta:
        verbose_name = "detalle de pedido"
        verbose_name_plural = "detalles de pedido"

    def __str__(self):
        return f"{self.cantidad} x {self.producto.nombre}"
