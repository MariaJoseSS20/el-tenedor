import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("pos", "0017_egreso_cajadiaria_total_egresos"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="Gasto",
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
                ("fecha", models.DateField(default=django.utils.timezone.localdate)),
                (
                    "tipo",
                    models.CharField(
                        choices=[("costo", "Costo"), ("gasto", "Gasto")],
                        max_length=10,
                    ),
                ),
                (
                    "categoria",
                    models.CharField(
                        choices=[
                            ("insumos", "Insumos / materia prima"),
                            ("empaques", "Empaques"),
                            ("sueldos", "Sueldos"),
                            ("arriendo", "Arriendo"),
                            ("servicios", "Servicios básicos"),
                            ("mantencion", "Mantención"),
                            ("transporte", "Transporte / delivery"),
                            ("marketing", "Publicidad"),
                            ("impuestos", "Impuestos y comisiones"),
                            ("otros", "Otros"),
                        ],
                        max_length=20,
                    ),
                ),
                ("descripcion", models.CharField(max_length=255)),
                ("monto", models.DecimalField(decimal_places=2, max_digits=12)),
                (
                    "medio_pago",
                    models.CharField(
                        choices=[
                            ("duena", "Pagado por la dueña"),
                            ("transferencia", "Transferencia"),
                            ("tarjeta", "Tarjeta"),
                            ("efectivo", "Efectivo (fuera de caja)"),
                            ("otro", "Otro"),
                        ],
                        default="duena",
                        max_length=20,
                    ),
                ),
                ("proveedor", models.CharField(blank=True, default="", max_length=120)),
                (
                    "documento",
                    models.CharField(
                        blank=True,
                        default="",
                        help_text="N° de boleta o factura (opcional).",
                        max_length=60,
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
                        related_name="gastos",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "verbose_name": "costo o gasto",
                "verbose_name_plural": "costos y gastos",
                "ordering": ["-fecha", "-creado_en"],
            },
        ),
    ]
