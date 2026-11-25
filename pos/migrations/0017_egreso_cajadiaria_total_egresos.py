import django.db.models.deletion
import django.utils.timezone
from decimal import Decimal

from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("pos", "0016_pedido_pagar_en_tienda"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="cajadiaria",
            name="total_egresos",
            field=models.DecimalField(
                decimal_places=2,
                default=Decimal("0.00"),
                help_text="Salidas de efectivo registradas en el día (egresos activos).",
                max_digits=12,
            ),
        ),
        migrations.CreateModel(
            name="Egreso",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                (
                    "fecha_hora",
                    models.DateTimeField(default=django.utils.timezone.now),
                ),
                ("monto", models.DecimalField(decimal_places=2, max_digits=12)),
                (
                    "descripcion",
                    models.CharField(
                        help_text="Motivo de la salida de efectivo. Ej. compra de hielo.",
                        max_length=255,
                    ),
                ),
                (
                    "estado",
                    models.CharField(
                        choices=[("activo", "Activo"), ("anulado", "Anulado")],
                        default="activo",
                        max_length=10,
                    ),
                ),
                ("creado_en", models.DateTimeField(auto_now_add=True)),
                (
                    "usuario",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="egresos",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "verbose_name": "egreso",
                "verbose_name_plural": "egresos",
                "ordering": ["-fecha_hora"],
            },
        ),
    ]
