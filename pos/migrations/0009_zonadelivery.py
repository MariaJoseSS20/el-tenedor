from decimal import Decimal

from django.db import migrations, models
import django.db.models.deletion


def seed_zonas(apps, schema_editor):
    ZonaDelivery = apps.get_model("pos", "ZonaDelivery")
    if ZonaDelivery.objects.exists():
        return
    ZonaDelivery.objects.bulk_create(
        [
            ZonaDelivery(
                nombre="Ciudad",
                descripcion="Dentro de la ciudad",
                precio=Decimal("3500.00"),
                activo=True,
                orden=1,
            ),
            ZonaDelivery(
                nombre="Rural",
                descripcion="Desde Tres Puentes a Barranco Amarillo",
                precio=Decimal("5000.00"),
                activo=True,
                orden=2,
            ),
        ]
    )


def unseed_zonas(apps, schema_editor):
    ZonaDelivery = apps.get_model("pos", "ZonaDelivery")
    ZonaDelivery.objects.filter(nombre__in=["Ciudad", "Rural"]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("pos", "0008_alter_inventario_options_remove_inventario_producto_and_more"),
    ]

    operations = [
        migrations.CreateModel(
            name="ZonaDelivery",
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
                ("nombre", models.CharField(max_length=80, unique=True)),
                (
                    "descripcion",
                    models.CharField(
                        blank=True,
                        default="",
                        help_text="Cobertura, por ejemplo: desde Tres Puentes a Barranco Amarillo.",
                        max_length=200,
                    ),
                ),
                ("precio", models.DecimalField(decimal_places=2, max_digits=10)),
                ("activo", models.BooleanField(default=True)),
                ("orden", models.PositiveSmallIntegerField(default=0)),
                ("creado_en", models.DateTimeField(auto_now_add=True)),
                ("actualizado_en", models.DateTimeField(auto_now=True)),
            ],
            options={
                "verbose_name": "zona de delivery",
                "verbose_name_plural": "zonas de delivery",
                "ordering": ["orden", "nombre"],
            },
        ),
        migrations.AddField(
            model_name="pedido",
            name="zona_delivery",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="pedidos",
                to="pos.zonadelivery",
            ),
        ),
        migrations.RunPython(seed_zonas, unseed_zonas),
    ]
