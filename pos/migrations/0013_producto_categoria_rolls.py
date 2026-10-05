from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("pos", "0012_pedido_conserva_zona"),
    ]

    operations = [
        migrations.AlterField(
            model_name="producto",
            name="categoria",
            field=models.CharField(
                choices=[
                    ("ceviches", "Ceviches"),
                    ("picoteo", "Algo para picar"),
                    ("papas", "Papas fritas"),
                    ("shawarmas", "Shawarmas"),
                    ("tablas", "Tablas"),
                    ("rolls", "Arma tu Roll"),
                    ("gohan", "Gohan"),
                    ("agregados", "Agregados"),
                    ("sushi", "Sushi"),
                    ("shawarma", "Shawarma"),
                    ("bebestibles", "Bebestibles"),
                ],
                max_length=20,
            ),
        ),
    ]
