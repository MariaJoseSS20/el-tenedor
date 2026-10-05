"""
Servicios de pedidos web: creación, confirmación Webpay y venta asociada.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from .models import CustomUser, DetallePedido, DetalleVenta, Pedido, Venta
from .serializers import USUARIO_PEDIDOS_WEB, dia_ya_cerrado
from . import webpay


def usuario_pedidos_web() -> CustomUser:
    user, created = CustomUser.objects.get_or_create(
        username=USUARIO_PEDIDOS_WEB,
        defaults={
            "rol": CustomUser.Rol.CAJERO,
            "is_active": True,
            "first_name": "Pedidos",
            "last_name": "Web",
        },
    )
    if created:
        user.set_unusable_password()
        user.save(update_fields=["password"])
    return user


def generar_buy_order() -> str:
    """Orden de compra única, máximo 26 caracteres (límite Webpay)."""
    return f"P{uuid.uuid4().hex[:24]}"


def notas_pedido_para_venta(pedido: Pedido) -> str:
    parts = [
        f"Cliente: {pedido.nombre_cliente}",
        f"Tel: {pedido.telefono}",
    ]
    if pedido.tipo_entrega == Venta.TipoEntrega.DELIVERY and pedido.zona_nombre:
        cobertura = f" ({pedido.zona_descripcion})" if pedido.zona_descripcion else ""
        parts.append(f"Zona: {pedido.zona_nombre}{cobertura}")
    if pedido.tipo_entrega == Venta.TipoEntrega.DELIVERY and pedido.direccion:
        parts.append(f"Dirección: {pedido.direccion}")
    if pedido.notas:
        parts.append(pedido.notas)
    parts.append("Pagado con Webpay")
    return " || ".join(parts)


@transaction.atomic
def crear_pedido_desde_payload(validated_data: dict) -> Pedido:
    productos = validated_data.pop("_productos")
    detalles_data = validated_data.pop("detalles")
    cobro = validated_data.pop("_cobro_delivery", Decimal("0.00"))
    zona = validated_data.pop("zona_delivery", None)

    pedido = Pedido.objects.create(
        nombre_cliente=validated_data["nombre_cliente"],
        telefono=validated_data["telefono"],
        tipo_entrega=validated_data["tipo_entrega"],
        direccion=validated_data.get("direccion") or "",
        notas=validated_data.get("notas") or "",
        cobro_delivery=cobro,
        zona_delivery=zona,
        zona_nombre=zona.nombre if zona is not None else "",
        zona_descripcion=zona.descripcion if zona is not None else "",
        total=Decimal("0.00"),
        estado=Pedido.Estado.ESPERANDO_PAGO,
        buy_order=generar_buy_order(),
    )

    total_detalles = Decimal("0.00")
    for item in detalles_data:
        producto = productos[item["producto"].pk]
        cantidad = item["cantidad"]
        subtotal = (producto.precio * cantidad).quantize(Decimal("0.01"))
        DetallePedido.objects.create(
            pedido=pedido,
            producto=producto,
            cantidad=cantidad,
            subtotal=subtotal,
            notas=item.get("notas") or "",
        )
        total_detalles += subtotal

    pedido.total = total_detalles + cobro
    pedido.save(update_fields=["total"])
    return pedido


def iniciar_pago_webpay(pedido: Pedido, return_url: str) -> dict:
    result = webpay.create_transaction(
        buy_order=pedido.buy_order,
        session_id=str(pedido.pk),
        amount=pedido.total,
        return_url=return_url,
    )
    pedido.webpay_token = result.token
    pedido.save(update_fields=["webpay_token", "actualizado_en"])
    return {"token": result.token, "url": result.url, "pedido_id": pedido.pk}


@transaction.atomic
def crear_venta_desde_pedido(pedido: Pedido) -> Venta:
    if pedido.venta_id:
        return pedido.venta

    ahora = timezone.now()
    if dia_ya_cerrado(ahora):
        raise serializers.ValidationError(
            {"detail": "La caja del día ya está cerrada; no se puede confirmar el pago."}
        )

    venta = Venta.objects.create(
        client_uuid=uuid.uuid4(),
        cajero=usuario_pedidos_web(),
        fecha_hora=ahora,
        metodo_pago=Venta.MetodoPago.WEBPAY,
        tipo_entrega=pedido.tipo_entrega,
        cobro_delivery=pedido.cobro_delivery,
        estado=Venta.Estado.COMPLETADA,
        notas=notas_pedido_para_venta(pedido),
        total=Decimal("0.00"),
    )

    total_detalles = Decimal("0.00")
    for det in pedido.detalles.select_related("producto"):
        DetalleVenta.objects.create(
            venta=venta,
            producto=det.producto,
            cantidad=det.cantidad,
            subtotal=det.subtotal,
            notas=det.notas or "",
        )
        total_detalles += det.subtotal

    venta.total = total_detalles + (pedido.cobro_delivery or Decimal("0.00"))
    venta.save(update_fields=["total"])
    pedido.venta = venta
    pedido.estado = Pedido.Estado.PAGADO
    pedido.save(update_fields=["venta", "estado", "actualizado_en"])
    return venta


def confirmar_pago_autorizado(pedido: Pedido, commit) -> Pedido:
    """Idempotente: si ya está pagado, no duplica la venta."""
    if pedido.estado == Pedido.Estado.PAGADO and pedido.venta_id:
        return pedido

    if pedido.estado not in (
        Pedido.Estado.ESPERANDO_PAGO,
        Pedido.Estado.PAGADO,
    ):
        raise serializers.ValidationError(
            {"detail": "El pedido no está esperando confirmación de pago."}
        )

    pedido.authorization_code = commit.authorization_code or pedido.authorization_code
    pedido.save(update_fields=["authorization_code", "actualizado_en"])
    crear_venta_desde_pedido(pedido)
    return pedido


def marcar_pedido_rechazado(pedido: Pedido) -> Pedido:
    if pedido.estado == Pedido.Estado.PAGADO:
        return pedido
    if pedido.estado != Pedido.Estado.RECHAZADO:
        pedido.estado = Pedido.Estado.RECHAZADO
        pedido.save(update_fields=["estado", "actualizado_en"])
    return pedido


def reembolsar_venta_webpay(venta: Venta) -> None:
    """Pide refund a Transbank. Lanza ValidationError si falla."""
    pedido = getattr(venta, "pedido_web", None)
    if pedido is None or not pedido.webpay_token:
        raise serializers.ValidationError(
            {"detail": "No hay token Webpay asociado a esta venta."}
        )
    try:
        result = webpay.refund_transaction(pedido.webpay_token, venta.total)
    except Exception as exc:  # noqa: BLE001 — SDK / red
        raise serializers.ValidationError(
            {"detail": f"Transbank no aceptó el reembolso: {exc}"}
        ) from exc

    # REVERSED o response_code 0 suelen indicar éxito.
    tipo = (result.type or "").upper()
    if result.response_code not in (0, None) and tipo not in (
        "REVERSED",
        "NULLIFIED",
    ):
        raise serializers.ValidationError(
            {
                "detail": (
                    "Transbank rechazó el reembolso "
                    f"(type={result.type}, code={result.response_code})."
                )
            }
        )
