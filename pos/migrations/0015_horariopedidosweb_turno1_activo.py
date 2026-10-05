from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("pos", "0014_horariopedidosweb"),
    ]

    operations = [
        migrations.AddField(
            model_name="horariopedidosweb",
            name="turno1_activo",
            field=models.BooleanField(default=True),
        ),
    ]
