from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("pos", "0009_zonadelivery"),
    ]

    operations = [
        migrations.AlterModelOptions(
            name="zonadelivery",
            options={
                "ordering": ["nombre"],
                "verbose_name": "zona de delivery",
                "verbose_name_plural": "zonas de delivery",
            },
        ),
        migrations.RemoveField(
            model_name="zonadelivery",
            name="orden",
        ),
    ]
