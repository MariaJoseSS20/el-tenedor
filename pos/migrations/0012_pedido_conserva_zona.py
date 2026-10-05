import django.db.models.deletion
from django.db import migrations, models


def copiar_zona_al_pedido(apps, schema_editor):
    Pedido = apps.get_model("pos", "Pedido")
    for pedido in Pedido.objects.exclude(zona_delivery_id=None).iterator():
        zona = pedido.zona_delivery
        pedido.zona_nombre = zona.nombre
        pedido.zona_descripcion = zona.descripcion
        pedido.save(update_fields=["zona_nombre", "zona_descripcion"])


class Migration(migrations.Migration):

    dependencies = [
        ("pos", "0011_quitar_activo_zona_delivery"),
    ]

    operations = [
        migrations.AddField(
            model_name="pedido",
            name="zona_nombre",
            field=models.CharField(
                blank=True,
                default="",
                help_text="Nombre de la zona al momento del pedido.",
                max_length=80,
            ),
        ),
        migrations.AddField(
            model_name="pedido",
            name="zona_descripcion",
            field=models.CharField(
                blank=True,
                default="",
                help_text="Cobertura de la zona al momento del pedido.",
                max_length=200,
            ),
        ),
        migrations.RunPython(copiar_zona_al_pedido, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="pedido",
            name="zona_delivery",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="pedidos",
                to="pos.zonadelivery",
            ),
        ),
    ]
