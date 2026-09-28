"""
Carga la carta real de El Tenedor General del Canto.

Uso:
  python manage.py seed_menu
  python manage.py seed_menu --reset
"""

from decimal import Decimal

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import transaction

from pos.models import CustomUser, Producto


# (nombre, descripcion, precio, categoria)
MENU = [
    # Ceviches
    ("Ceviche de Salmón", "", "7000", "ceviches"),
    ("Ceviche de Camarón", "", "8200", "ceviches"),
    ("Ceviche Mixto", "Camarón y salmón", "8000", "ceviches"),
    ("Ceviche Tenedor", "", "8500", "ceviches"),
    ("Ceviche Vegetariano", "", "6500", "ceviches"),
    # Picoteo
    ("Bastones de Pollo Furay (5u)", "", "6300", "picoteo"),
    ("Bastones de Salmón Furay (5u)", "", "6300", "picoteo"),
    ("Gyozas (5u)", "Camarón, pollo, vegetariana o cerdo", "6600", "picoteo"),
    ("Bastones Queso Phila (5u)", "", "6500", "picoteo"),
    ("Bastones Queso Gauda (5u)", "", "6500", "picoteo"),
    ("Camarones Furay (5u)", "", "6500", "picoteo"),
    ("Camarones Tenedor (5u)", "", "8200", "picoteo"),
    ("Arrollados Primavera (5u)", "", "6500", "picoteo"),
    ("Arrollados Jamón Queso (5u)", "", "5800", "picoteo"),
    ("Arrollados Camarón Spicy (10u)", "", "5800", "picoteo"),
    ("Korokes (10u)", "", "5200", "picoteo"),
    ("Falafel (10u)", "", "6000", "picoteo"),
    ("Empanaditas Fritas (10u)", "", "5000", "picoteo"),
    ("Aros de Cebolla (10u)", "", "5000", "picoteo"),
    ("Pop Chicken (150 grs)", "", "4990", "picoteo"),
    # Papas
    ("Papas Fritas Normales", "", "6000", "papas"),
    ("Papas Fritas con Guacamole", "", "7000", "papas"),
    ("Papas Fritas Carne Queso", "", "7500", "papas"),
    ("Papas Fritas Queso Fundido", "", "6500", "papas"),
    ("Papas Fritas Tenedor", "", "8000", "papas"),
    # Shawarmas
    ("Shawarma Vegetariano", "Lechuga - Tomate - Palta - Choclo", "6300", "shawarmas"),
    ("Shawarma Falafel", "Falafel - Lechuga - Tomate - Choclo - Palta", "6500", "shawarmas"),
    ("Shawarma Pollo", "Lechuga - Tomate - Pollo Mechado", "6700", "shawarmas"),
    ("Shawarma Pollo Furay", "Lechuga - Tomate - Pollo - Tiras de Pollo Furay", "7000", "shawarmas"),
    ("Shawarma Mixto", "Lechuga - Tomate - Pollo Mechado y Carne Mechada", "7500", "shawarmas"),
    ("Shawarma Chacarero", "Carne o Pollo - Tomate - Poroto Verde - Ají Verde", "7500", "shawarmas"),
    ("Shawarma Chacarero Magallánico", "Carne o Pollo - Lechuga - Tomate - Poroto Verde", "7500", "shawarmas"),
    ("Shawarma Italiano", "Carne o Pollo - Tomate - Palta", "7500", "shawarmas"),
    ("Shawarma Mixto Italiano", "Carne y Pollo - Tomate - Palta", "8000", "shawarmas"),
    ("Shawarma Luco", "Carne o Pollo - Queso Fundido", "8000", "shawarmas"),
    ("Shawarma Big", "Carne o Pollo - Tomate - Pepinillo - Aros de Cebolla - Tocino - Queso", "8500", "shawarmas"),
    ("Shawarma Tenedor", "Carne o Pollo - Tomate - Lechuga - Cebolla Frita - Queso Fundido", "8700", "shawarmas"),
    # Tablas
    ("Tabla 27 Bocados", "3 tipos de rolls", "16000", "tablas"),
    ("Tabla 36 Bocados", "4 tipos de rolls", "20000", "tablas"),
    ("Tabla 45 Bocados", "5 tipos de rolls", "22500", "tablas"),
    ("Tabla 63 Bocados", "7 tipos de rolls", "29000", "tablas"),
    ("Tabla 90 Bocados", "10 tipos de rolls", "41000", "tablas"),
    ("Tabla 108 Bocados", "12 tipos de rolls", "47000", "tablas"),
    # Gohan
    ("Gohan", "Base arroz + queso phila / salsa + espolvoreado", "7000", "gohan"),
    # Bebestibles
    ("Coca-Cola 350 ml", "", "1500", "bebestibles"),
    ("Coca-Cola Zero 350 ml", "", "1500", "bebestibles"),
    ("Sprite 350 ml", "", "1500", "bebestibles"),
    ("Fanta 350 ml", "", "1500", "bebestibles"),
    ("Agua mineral 500 ml", "", "1200", "bebestibles"),
    ("Jugo natural", "", "2500", "bebestibles"),
    # Agregados
    ("Palta extra", "Agregar palta", "1000", "agregados"),
    ("Salsa extra", "Ajo, merkén, cilantro o ciboulette", "800", "agregados"),
    ("Proteína Furay", "Extra furay en gohan", "500", "agregados"),
]


class Command(BaseCommand):
    help = "Carga la carta de El Tenedor General del Canto."

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Elimina productos existentes antes de cargar.",
        )
        parser.add_argument(
            "--with-demo-users",
            action="store_true",
            help="Crea usuarios demo aunque SEED_DEMO_USERS esté desactivado.",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        if options["reset"]:
            Producto.objects.all().delete()
            self.stdout.write(self.style.WARNING("Catálogo de productos eliminado."))

        creados = 0
        actualizados = 0
        for nombre, descripcion, precio, categoria in MENU:
            _, created = Producto.objects.update_or_create(
                nombre=nombre,
                defaults={
                    "descripcion": descripcion,
                    "precio": Decimal(precio),
                    "categoria": categoria,
                    "estado": Producto.Estado.ACTIVO,
                },
            )
            if created:
                creados += 1
            else:
                actualizados += 1

        # Productos antiguos fuera de carta: se desactivan (no se borran si hay ventas).
        nombres_carta = {n for n, *_ in MENU}
        desactivados = Producto.objects.exclude(nombre__in=nombres_carta).exclude(
            estado=Producto.Estado.INACTIVO
        ).update(estado=Producto.Estado.INACTIVO)
        if desactivados:
            self.stdout.write(
                self.style.WARNING(f"Productos fuera de carta desactivados: {desactivados}")
            )

        self._asegurar_usuarios_demo(force=options["with_demo_users"])
        self.stdout.write(
            self.style.SUCCESS(
                f"Carta lista: {creados} creados, {actualizados} actualizados. "
                f"Total productos: {Producto.objects.count()}."
            )
        )

    def _asegurar_usuarios_demo(self, force=False):
        if not force and not getattr(settings, "SEED_DEMO_USERS", False):
            self.stdout.write(
                "Usuarios demo omitidos (producción). "
                "Usa --with-demo-users o SEED_DEMO_USERS=True si los necesitas."
            )
            return

        demos = [
            ("admin", "admin123", CustomUser.Rol.ADMINISTRADOR, True),
            ("cajero1", "cajero123", CustomUser.Rol.CAJERO, False),
        ]
        for username, password, rol, is_staff in demos:
            user, created = CustomUser.objects.get_or_create(
                username=username,
                defaults={"rol": rol, "is_staff": is_staff},
            )
            if created:
                user.set_password(password)
                user.rol = rol
                user.is_staff = is_staff
                user.save()
                self.stdout.write(f"Usuario demo creado: {username} / {password}")
            elif user.rol != rol:
                user.rol = rol
                user.save(update_fields=["rol"])
