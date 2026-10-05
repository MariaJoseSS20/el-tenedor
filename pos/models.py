"""

Modelos del POS El Tenedor.



Reglas clave:

- Cada venta queda trazada al cajero autenticado.

- Inventario 1:1 con Producto (catálogo de ítems inventariables).

  El control de cantidades/stock se definirá en una iteración posterior.

- client_uuid en Venta evita duplicados al reintentar sync offline.

"""

from datetime import time
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
        ROLLS = "rolls", "Arma tu Roll"
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
    Registro de inventario de empaques utilizados por el local.

    Los empaques se registran manualmente y no dependen de los
    productos del menú. La cantidad puede modificarse para mantener
    actualizado el stock disponible.
    """

    nombre = models.CharField(
    max_length=150,
    default="",
    help_text="Nombre del empaque.",
)

    cantidad = models.PositiveIntegerField(
        default=0,
        help_text="Cantidad de unidades disponibles.",
    )

    notas = models.TextField(
        blank=True,
        help_text="Observaciones internas del empaque.",
    )

    ultima_actualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["nombre"]
        verbose_name = "inventario"
        verbose_name_plural = "inventarios"

    def __str__(self):
        return f"{self.nombre} — {self.cantidad} unidades"


class ZonaDelivery(models.Model):
    """Tarifa de delivery que configura el administrador."""

    nombre = models.CharField(max_length=80, unique=True)
    descripcion = models.CharField(
        max_length=200,
        blank=True,
        default="",
        help_text="Cobertura, por ejemplo: desde Tres Puentes a Barranco Amarillo.",
    )
    precio = models.DecimalField(max_digits=10, decimal_places=2)
    creado_en = models.DateTimeField(auto_now_add=True)
    actualizado_en = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["nombre"]
        verbose_name = "zona de delivery"
        verbose_name_plural = "zonas de delivery"

    def __str__(self):
        return f"{self.nombre} (${self.precio})"


class HorarioPedidosWeb(models.Model):
    """
    Configuración única (pk=1) del horario de pedidos online.
    Editable desde el panel del administrador.
    """

    habilitado = models.BooleanField(
        default=True,
        help_text="Si está apagado, no se reciben pedidos web aunque esté en horario.",
    )
    lunes = models.BooleanField(default=True)
    martes = models.BooleanField(default=True)
    miercoles = models.BooleanField(default=True)
    jueves = models.BooleanField(default=True)
    viernes = models.BooleanField(default=True)
    sabado = models.BooleanField(default=True)
    domingo = models.BooleanField(default=False)
    turno1_inicio = models.TimeField(default=time(12, 0))
    turno1_fin = models.TimeField(default=time(15, 45))
    turno2_activo = models.BooleanField(default=True)
    turno2_inicio = models.TimeField(default=time(18, 0))
    turno2_fin = models.TimeField(default=time(22, 45))
    texto_horario = models.CharField(
        max_length=200,
        default="Lunes a sábado: 12:00–15:45 y 18:00–22:45",
        help_text="Texto corto que se muestra en la carta.",
    )
    mensaje_cerrado = models.TextField(
        default=(
            "Ahora no recibimos pedidos online. "
            "Horario: lunes a sábado de 12:00 a 15:45 y de 18:00 a 22:45."
        ),
        help_text="Mensaje cuando está cerrado o deshabilitado.",
    )
    actualizado_en = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "horario de pedidos web"
        verbose_name_plural = "horario de pedidos web"

    def __str__(self):
        return "Horario de pedidos web"

    def clean(self):
        if self.turno1_inicio >= self.turno1_fin:
            raise ValidationError(
                {"turno1_fin": "La hora de fin del turno 1 debe ser posterior al inicio."}
            )
        if self.turno2_activo:
            if self.turno2_inicio >= self.turno2_fin:
                raise ValidationError(
                    {
                        "turno2_fin": "La hora de fin del turno 2 debe ser posterior al inicio."
                    }
                )

    def save(self, *args, **kwargs):
        self.pk = 1
        self.full_clean()
        return super().save(*args, **kwargs)

    @classmethod
    def get_solo(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def dias_abiertos(self):
        """weekday() lunes=0 … domingo=6 → set de días activos."""
        flags = (
            self.lunes,
            self.martes,
            self.miercoles,
            self.jueves,
            self.viernes,
            self.sabado,
            self.domingo,
        )
        return {i for i, on in enumerate(flags) if on}

    def ventanas_minutos(self):
        def a_mins(t):
            return t.hour * 60 + t.minute

        ventanas = [(a_mins(self.turno1_inicio), a_mins(self.turno1_fin))]
        if self.turno2_activo:
            ventanas.append((a_mins(self.turno2_inicio), a_mins(self.turno2_fin)))
        return ventanas


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



class PagoVenta(models.Model):

    """

    Pago asociado a una venta.



    Una venta puede tener uno o más pagos, lo que permite registrar

    pagos simples y pagos mixtos.

    """



    class MetodoPago(models.TextChoices):

        EFECTIVO = "efectivo", "Efectivo"

        DEBITO = "debito", "Tarjeta débito"

        CREDITO = "credito", "Tarjeta crédito"

        TRANSFERENCIA = "transferencia", "Transferencia"

        WEBPAY = "webpay", "Webpay"



    venta = models.ForeignKey(

        Venta,

        on_delete=models.CASCADE,

        related_name="pagos",

    )

    metodo = models.CharField(

        max_length=20,

        choices=MetodoPago.choices,

    )

    monto = models.DecimalField(

        max_digits=12,

        decimal_places=2,

    )



    class Meta:

        verbose_name = "pago de venta"

        verbose_name_plural = "pagos de venta"



    def __str__(self):

        return f"{self.get_metodo_display()} — {self.monto}"





class CajaDiaria(models.Model):
    """
    Cierre de caja del día.
    Los totales se calculan a partir de ventas Completadas (no se editan a mano).
    """

    fecha = models.DateField(unique=True)

    total_efectivo = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    total_tarjetas = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    total_debito = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    total_credito = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("0.00"),
    )
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
            f"T:{self.total_tarjetas} D:{self.total_debito} "
            f"C:{self.total_credito} Tr:{self.total_transferencias} "
            f"W:{self.total_webpay}"
        )

    @property
    def total_general(self):
        return (
            self.total_efectivo
            + self.total_tarjetas
            + self.total_debito
            + self.total_credito
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
    zona_delivery = models.ForeignKey(
        ZonaDelivery,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="pedidos",
    )
    zona_nombre = models.CharField(
        max_length=80,
        blank=True,
        default="",
        help_text="Nombre de la zona al momento del pedido.",
    )
    zona_descripcion = models.CharField(
        max_length=200,
        blank=True,
        default="",
        help_text="Cobertura de la zona al momento del pedido.",
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
