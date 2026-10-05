from datetime import time

from django.db import migrations, models


def crear_horario_default(apps, schema_editor):
    HorarioPedidosWeb = apps.get_model("pos", "HorarioPedidosWeb")
    if HorarioPedidosWeb.objects.filter(pk=1).exists():
        return
    HorarioPedidosWeb.objects.create(
        pk=1,
        habilitado=True,
        lunes=True,
        martes=True,
        miercoles=True,
        jueves=True,
        viernes=True,
        sabado=True,
        domingo=False,
        turno1_inicio=time(12, 0),
        turno1_fin=time(15, 45),
        turno2_activo=True,
        turno2_inicio=time(18, 0),
        turno2_fin=time(22, 45),
        texto_horario="Lunes a sábado: 12:00–15:45 y 18:00–22:45",
        mensaje_cerrado=(
            "Ahora no recibimos pedidos online. "
            "Horario: lunes a sábado de 12:00 a 15:45 y de 18:00 a 22:45."
        ),
    )


def borrar_horario(apps, schema_editor):
    HorarioPedidosWeb = apps.get_model("pos", "HorarioPedidosWeb")
    HorarioPedidosWeb.objects.filter(pk=1).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("pos", "0013_producto_categoria_rolls"),
    ]

    operations = [
        migrations.CreateModel(
            name="HorarioPedidosWeb",
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
                    "habilitado",
                    models.BooleanField(
                        default=True,
                        help_text="Si está apagado, no se reciben pedidos web aunque esté en horario.",
                    ),
                ),
                ("lunes", models.BooleanField(default=True)),
                ("martes", models.BooleanField(default=True)),
                ("miercoles", models.BooleanField(default=True)),
                ("jueves", models.BooleanField(default=True)),
                ("viernes", models.BooleanField(default=True)),
                ("sabado", models.BooleanField(default=True)),
                ("domingo", models.BooleanField(default=False)),
                ("turno1_inicio", models.TimeField(default=time(12, 0))),
                ("turno1_fin", models.TimeField(default=time(15, 45))),
                ("turno2_activo", models.BooleanField(default=True)),
                ("turno2_inicio", models.TimeField(default=time(18, 0))),
                ("turno2_fin", models.TimeField(default=time(22, 45))),
                (
                    "texto_horario",
                    models.CharField(
                        default="Lunes a sábado: 12:00–15:45 y 18:00–22:45",
                        help_text="Texto corto que se muestra en la carta.",
                        max_length=200,
                    ),
                ),
                (
                    "mensaje_cerrado",
                    models.TextField(
                        default=(
                            "Ahora no recibimos pedidos online. "
                            "Horario: lunes a sábado de 12:00 a 15:45 y de 18:00 a 22:45."
                        ),
                        help_text="Mensaje cuando está cerrado o deshabilitado.",
                    ),
                ),
                ("actualizado_en", models.DateTimeField(auto_now=True)),
            ],
            options={
                "verbose_name": "horario de pedidos web",
                "verbose_name_plural": "horario de pedidos web",
            },
        ),
        migrations.RunPython(crear_horario_default, borrar_horario),
    ]
