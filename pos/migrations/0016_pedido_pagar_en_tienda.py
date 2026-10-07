from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("pos", "0015_horariopedidosweb_turno1_activo"),
    ]

    operations = [
        migrations.AddField(
            model_name="pedido",
            name="metodo_pago",
            field=models.CharField(
                choices=[("webpay", "Webpay"), ("tienda", "Pagar en tienda")],
                default="webpay",
                max_length=20,
            ),
        ),
        migrations.AlterField(
            model_name="pedido",
            name="estado",
            field=models.CharField(
                choices=[
                    ("esperando_pago", "Esperando pago"),
                    ("pagado", "Pagado"),
                    ("en_tienda", "Pagar en tienda"),
                    ("recibido", "Recibido"),
                    ("rechazado", "Rechazado"),
                ],
                default="esperando_pago",
                max_length=20,
            ),
        ),
    ]
