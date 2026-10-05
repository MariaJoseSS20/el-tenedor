"""
Horario de pedidos web (carta / Webpay).

Lee la configuración del administrador (modelo HorarioPedidosWeb).
Si aún no hay fila en BD, usa defaults lun–sáb 12:00–15:45 y 18:00–22:45.
"""

from __future__ import annotations

from datetime import time

from django.utils import timezone

# Defaults (mismo criterio que el seed del modelo)
DEFAULT_DIAS = frozenset({0, 1, 2, 3, 4, 5})  # lun–sáb
DEFAULT_VENTANAS = (
    (12 * 60, 15 * 60 + 45),
    (18 * 60, 22 * 60 + 45),
)
DEFAULT_HORARIO_TEXTO = "Lunes a sábado: 12:00–15:45 y 18:00–22:45"
MENSAJE_CERRADO = (
    "Ahora no recibimos pedidos online. "
    "Horario: lunes a sábado de 12:00 a 15:45 y de 18:00 a 22:45."
)


def _minutos_del_dia(momento) -> int:
    return momento.hour * 60 + momento.minute


def _cargar_config():
    try:
        from .models import HorarioPedidosWeb

        return HorarioPedidosWeb.get_solo()
    except Exception:  # noqa: BLE001 — migraciones / BD no lista
        return None


def _reglas_desde_config(cfg):
    if cfg is None:
        return {
            "habilitado": True,
            "dias": DEFAULT_DIAS,
            "ventanas": DEFAULT_VENTANAS,
            "texto_horario": DEFAULT_HORARIO_TEXTO,
            "mensaje_cerrado": MENSAJE_CERRADO,
        }
    return {
        "habilitado": bool(cfg.habilitado),
        "dias": cfg.dias_abiertos(),
        "ventanas": cfg.ventanas_minutos(),
        "texto_horario": cfg.texto_horario or DEFAULT_HORARIO_TEXTO,
        "mensaje_cerrado": cfg.mensaje_cerrado or MENSAJE_CERRADO,
    }


def _en_ventana(mins: int, ventanas) -> bool:
    return any(inicio <= mins <= fin for inicio, fin in ventanas)


def estado_pedidos_web(momento=None) -> dict:
    """Estado público para la carta y validación del servidor."""
    momento = timezone.localtime(momento) if momento is not None else timezone.localtime()
    reglas = _reglas_desde_config(_cargar_config())
    abierto = (
        reglas["habilitado"]
        and momento.weekday() in reglas["dias"]
        and _en_ventana(_minutos_del_dia(momento), reglas["ventanas"])
    )
    return {
        "abierto": abierto,
        "mensaje": "" if abierto else reglas["mensaje_cerrado"],
        "horario": reglas["texto_horario"],
        "zona": str(timezone.get_current_timezone()),
        "habilitado": reglas["habilitado"],
    }


def pedidos_web_abiertos(momento=None) -> bool:
    return bool(estado_pedidos_web(momento)["abierto"])


def defaults_modelo():
    """Valores por defecto para migración / get_or_create."""
    return {
        "habilitado": True,
        "lunes": True,
        "martes": True,
        "miercoles": True,
        "jueves": True,
        "viernes": True,
        "sabado": True,
        "domingo": False,
        "turno1_activo": True,
        "turno1_inicio": time(12, 0),
        "turno1_fin": time(15, 45),
        "turno2_activo": True,
        "turno2_inicio": time(18, 0),
        "turno2_fin": time(22, 45),
        "texto_horario": DEFAULT_HORARIO_TEXTO,
        "mensaje_cerrado": MENSAJE_CERRADO,
    }
