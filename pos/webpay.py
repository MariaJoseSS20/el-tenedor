"""
Cliente Webpay Plus (Transbank).

Usa integración por defecto; producción si hay credenciales y WEBPAY_ENV=production.
Las llamadas reales se pueden reemplazar en tests con monkeypatch.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from django.conf import settings
from transbank.common.integration_api_keys import IntegrationApiKeys
from transbank.common.integration_commerce_codes import IntegrationCommerceCodes
from transbank.webpay.webpay_plus.transaction import Transaction


@dataclass
class WebpayCreateResult:
    token: str
    url: str


@dataclass
class WebpayCommitResult:
    status: str
    authorization_code: str
    amount: Decimal
    buy_order: str
    response_code: int | None = None


@dataclass
class WebpayRefundResult:
    type: str
    response_code: int | None = None
    authorization_code: str = ""


def _transaction() -> Transaction:
    commerce = getattr(settings, "WEBPAY_COMMERCE_CODE", "") or ""
    api_key = getattr(settings, "WEBPAY_API_KEY", "") or ""
    env = getattr(settings, "WEBPAY_ENV", "integration").lower()

    if env == "production" and commerce and api_key:
        return Transaction.build_for_production(commerce, api_key)

    return Transaction.build_for_integration(
        commerce or IntegrationCommerceCodes.WEBPAY_PLUS,
        api_key or IntegrationApiKeys.WEBPAY,
    )


def monto_webpay(total: Decimal) -> int:
    """Webpay Chile espera monto entero en pesos."""
    return int(Decimal(total).quantize(Decimal("1")))


def create_transaction(
    buy_order: str,
    session_id: str,
    amount: Decimal,
    return_url: str,
) -> WebpayCreateResult:
    tx = _transaction()
    raw = tx.create(buy_order, session_id, float(monto_webpay(amount)), return_url)
    if isinstance(raw, dict):
        return WebpayCreateResult(token=raw["token"], url=raw["url"])
    return WebpayCreateResult(token=raw.token, url=raw.url)


def commit_transaction(token: str) -> WebpayCommitResult:
    tx = _transaction()
    raw = tx.commit(token)
    if isinstance(raw, dict):
        return WebpayCommitResult(
            status=str(raw.get("status") or ""),
            authorization_code=str(raw.get("authorization_code") or ""),
            amount=Decimal(str(raw.get("amount") or 0)),
            buy_order=str(raw.get("buy_order") or ""),
            response_code=raw.get("response_code"),
        )
    return WebpayCommitResult(
        status=str(getattr(raw, "status", "") or ""),
        authorization_code=str(getattr(raw, "authorization_code", "") or ""),
        amount=Decimal(str(getattr(raw, "amount", 0) or 0)),
        buy_order=str(getattr(raw, "buy_order", "") or ""),
        response_code=getattr(raw, "response_code", None),
    )


def refund_transaction(token: str, amount: Decimal) -> WebpayRefundResult:
    tx = _transaction()
    raw = tx.refund(token, float(monto_webpay(amount)))
    if isinstance(raw, dict):
        return WebpayRefundResult(
            type=str(raw.get("type") or ""),
            response_code=raw.get("response_code"),
            authorization_code=str(raw.get("authorization_code") or ""),
        )
    return WebpayRefundResult(
        type=str(getattr(raw, "type", "") or ""),
        response_code=getattr(raw, "response_code", None),
        authorization_code=str(getattr(raw, "authorization_code", "") or ""),
    )
