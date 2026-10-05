from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("pos", "0010_quitar_orden_zona_delivery"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="zonadelivery",
            name="activo",
        ),
    ]
