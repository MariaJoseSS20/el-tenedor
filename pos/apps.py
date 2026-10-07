from django.apps import AppConfig


class PosConfig(AppConfig):
    name = "pos"

    def ready(self):
        from django.db.utils import OperationalError, ProgrammingError

        try:
            aligerar_claves_demo()
        except (OperationalError, ProgrammingError):
            pass


def aligerar_claves_demo():
    """Si admin y cajero1 siguen con la clave de demo, guarda el hash liviano al arrancar."""
    from pos.models import CustomUser

    demos = (("admin", "admin123"), ("cajero1", "cajero123"))
    for username, password in demos:
        user = CustomUser.objects.filter(username=username).first()
        if user is None or not user.has_usable_password():
            continue
        try:
            iterations = int(user.password.split("$", 2)[1])
        except (IndexError, ValueError):
            continue
        if iterations <= 100_000:
            continue
        user.check_password(password)
