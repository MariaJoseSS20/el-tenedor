# Generated manually for Venta.notas

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("pos", "0003_detalle_notas"),
    ]

    operations = [
        migrations.AddField(
            model_name="venta",
            name="notas",
            field=models.TextField(
                blank=True,
                default="",
                help_text="Nota general del pedido (cliente / cocina).",
            ),
        ),
    ]
