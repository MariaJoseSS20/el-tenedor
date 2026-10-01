"""
Vistas API — El Tenedor.

Incluye ViewSets REST y el endpoint crítico de sincronización offline
POST /api/sync-ventas/ con transaction.atomic por venta e idempotencia por client_uuid.
Sin descuento de stock: el inventario se gestiona aparte.
Las ventas no se borran: solo se anulan (auditoría de caja).
"""

from decimal import Decimal

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import F, Sum
from django.shortcuts import redirect
from django.utils import timezone
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

from .models import CajaDiaria, DetalleVenta, Inventario, Pedido, Producto, Venta
from .permissions import (
    EsAdministrador,
    EsCajeroOAdministrador,
    LecturaTodosEscrituraAdmin,
    PermisoVentas,
)
from .serializers import (
    CajaDiariaCierreSerializer,
    CajaDiariaSerializer,
    CartaProductoSerializer,
    CustomUserSerializer,
    InventarioSerializer,
    PedidoCreateSerializer,
    PedidoSerializer,
    ProductoSerializer,
    SyncVentaItemSerializer,
    SyncVentasSerializer,
    VentaSerializer,
    dia_ya_cerrado,
    normalizar_fecha_sync,
    validar_entrega_y_cobro,
)
from .services_pedidos import (
    confirmar_pago_autorizado,
    crear_pedido_desde_payload,
    iniciar_pago_webpay,
    marcar_pedido_rechazado,
    reembolsar_venta_webpay,
)
from . import webpay


def _suma_metodo(ventas_qs, metodo):
    return ventas_qs.filter(metodo_pago=metodo).aggregate(t=Sum("total"))[
        "t"
    ] or Decimal("0.00")


def _totales_caja_para_fecha(fecha):
    """Totales de ventas completadas de una fecha local."""
    ventas = Venta.objects.filter(
        fecha_hora__date=fecha,
        estado=Venta.Estado.COMPLETADA,
    )
    return {
        "total_efectivo": _suma_metodo(ventas, Venta.MetodoPago.EFECTIVO),
        "total_tarjetas": _suma_metodo(ventas, Venta.MetodoPago.TARJETA),
        "total_transferencias": _suma_metodo(
            ventas, Venta.MetodoPago.TRANSFERENCIA
        ),
        "total_webpay": _suma_metodo(ventas, Venta.MetodoPago.WEBPAY),
        "cantidad_ventas": ventas.count(),
        "ventas": ventas,
    }


def recalcular_caja_si_existe(fecha_hora):
    """Si hay cierre para la fecha local de la venta, actualiza los totales."""
    fecha = timezone.localtime(fecha_hora).date()
    try:
        caja = CajaDiaria.objects.get(fecha=fecha)
    except CajaDiaria.DoesNotExist:
        return None
    totales = _totales_caja_para_fecha(fecha)
    caja.total_efectivo = totales["total_efectivo"]
    caja.total_tarjetas = totales["total_tarjetas"]
    caja.total_transferencias = totales["total_transferencias"]
    caja.total_webpay = totales["total_webpay"]
    caja.save(
        update_fields=[
            "total_efectivo",
            "total_tarjetas",
            "total_transferencias",
            "total_webpay",
        ]
    )
    return caja


def _frontend_pedir_redirect(params: dict) -> str:
    from urllib.parse import urlencode

    base = settings.FRONTEND_PEDIR_URL
    qs = urlencode({k: v for k, v in params.items() if v is not None})
    sep = "&" if "?" in base else "?"
    return f"{base}{sep}{qs}" if qs else base


class PedidosAnonThrottle(AnonRateThrottle):
    scope = "pedidos"


def _motivo_validacion(exc):
    """Convierte ValidationError / dict a un texto corto para el cliente."""
    if isinstance(exc, serializers.ValidationError):
        detail = exc.detail
    else:
        detail = exc
    if isinstance(detail, dict):
        partes = []
        for key, val in detail.items():
            if isinstance(val, (list, tuple)):
                texto = "; ".join(str(v) for v in val)
            else:
                texto = str(val)
            if key in ("detail", "non_field_errors"):
                partes.append(texto)
            else:
                partes.append(f"{key}: {texto}")
        return " | ".join(partes) if partes else str(detail)
    if isinstance(detail, list):
        return "; ".join(str(v) for v in detail)
    return str(detail)


class MeView(APIView):
    """Perfil del usuario autenticado (rol para la PWA)."""

    def get(self, request):
        return Response(CustomUserSerializer(request.user).data)


class ProductoViewSet(viewsets.ModelViewSet):
    """
    CRUD de productos.
    Cajero: solo lectura. Administrador: CRUD completo.
    """

    queryset = Producto.objects.select_related("inventario").all()
    serializer_class = ProductoSerializer
    permission_classes = [LecturaTodosEscrituraAdmin]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if not getattr(user, "es_administrador", False):
            qs = qs.filter(estado=Producto.Estado.ACTIVO)
        return qs


class InventarioViewSet(viewsets.ModelViewSet):
    """
    Inventario (1:1 con producto).
    Cajero: solo GET.
    Administrador: agregar (POST), editar notas (PATCH) y quitar (DELETE).
    No se crea solo: el admin decide qué productos entran al inventario.
    """

    queryset = Inventario.objects.select_related("producto").all()
    serializer_class = InventarioSerializer
    permission_classes = [LecturaTodosEscrituraAdmin]
    http_method_names = ["get", "post", "put", "patch", "delete", "head", "options"]


class VentaViewSet(
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    mixins.ListModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """
    Ventas del local.
    - POST: cajero y admin (registro rápido / online).
    - GET: cajero ve las propias; admin ve el historial completo.
    - PATCH (anular): solo administrador.
    - Sin DELETE: las ventas se anulan para conservar auditoría.
    """

    serializer_class = VentaSerializer
    permission_classes = [PermisoVentas]
    http_method_names = ["get", "post", "put", "patch", "head", "options"]
    queryset = Venta.objects.select_related("cajero").prefetch_related(
        "detalles__producto"
    )

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if not getattr(user, "es_administrador", False):
            qs = qs.filter(cajero=user)
        return qs

    def perform_create(self, serializer):
        serializer.save()

    def partial_update(self, request, *args, **kwargs):
        """
        Anulación de venta (solo Administrador).
        Body esperado: {"estado": "anulada"}
        Si el día ya tenía cierre, se recalculan los totales de esa caja.
        """
        venta = self.get_object()
        nuevo_estado = request.data.get("estado")

        if nuevo_estado != Venta.Estado.ANULADA:
            return Response(
                {"detail": "Solo se permite cambiar el estado a 'anulada'."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if venta.estado == Venta.Estado.ANULADA:
            return Response(
                {"detail": "La venta ya está anulada."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if venta.metodo_pago == Venta.MetodoPago.WEBPAY:
            try:
                reembolsar_venta_webpay(venta)
            except serializers.ValidationError as exc:
                return Response(exc.detail, status=status.HTTP_400_BAD_REQUEST)

        venta.estado = Venta.Estado.ANULADA
        venta.save(update_fields=["estado"])
        recalcular_caja_si_existe(venta.fecha_hora)

        return Response(VentaSerializer(venta, context={"request": request}).data)

    def update(self, request, *args, **kwargs):
        if kwargs.get("partial"):
            return self.partial_update(request, *args, **kwargs)
        return Response(
            {"detail": "Use PATCH con {\"estado\": \"anulada\"} para anular."},
            status=status.HTTP_405_METHOD_NOT_ALLOWED,
        )


class SyncVentasView(APIView):
    """
    Endpoint crítico de operatividad offline.

    La PWA guarda ventas en IndexedDB sin internet y, al recuperar señal,
    envía el lote a POST /api/sync-ventas/.

    Garantías:
    - Cada venta del lote en su propia transaction.atomic.
    - Una inválida va a "rechazadas" y no bloquea las demás.
    - Idempotencia: client_uuid ya existentes se omiten (no duplican).
    - Permisos: cajero y administrador autenticados (JWT).
    """

    permission_classes = [PermisoVentas]

    def post(self, request, *args, **kwargs):
        serializer = SyncVentasSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ventas_data = serializer.validated_data["ventas"]
        resultado = self._procesar_lote(request.user, ventas_data)
        return Response(resultado, status=status.HTTP_201_CREATED)

    def _procesar_lote(self, usuario, ventas_data):
        # Validar cada ítem por separado (rechazo parcial).
        items_ok = []
        rechazadas = []
        for raw in ventas_data:
            item_ser = SyncVentaItemSerializer(data=raw)
            if not item_ser.is_valid():
                uid = str(raw.get("client_uuid") or "?")
                rechazadas.append(
                    {
                        "client_uuid": uid,
                        "motivo": _motivo_validacion(item_ser.errors),
                    }
                )
                continue
            items_ok.append(item_ser.validated_data)

        uuids = [item["client_uuid"] for item in items_ok]
        existentes = set(
            Venta.objects.filter(client_uuid__in=uuids).values_list(
                "client_uuid", flat=True
            )
        )

        pendientes = [
            item for item in items_ok if item["client_uuid"] not in existentes
        ]
        omitidas = [
            str(item["client_uuid"])
            for item in items_ok
            if item["client_uuid"] in existentes
        ]

        if not pendientes and not rechazadas:
            return {
                "creadas": [],
                "omitidas_idempotentes": omitidas,
                "rechazadas": [],
                "mensaje": "Todas las ventas del lote ya estaban sincronizadas.",
            }

        producto_ids = {
            det["producto"].pk
            for item in pendientes
            for det in item["detalles"]
        }
        productos = {
            p.pk: p for p in Producto.objects.filter(pk__in=producto_ids)
        }

        creadas = []

        for item in pendientes:
            uuid_str = str(item["client_uuid"])
            try:
                with transaction.atomic():
                    cobro = item.get("cobro_delivery") or Decimal("0.00")
                    validar_entrega_y_cobro(item["tipo_entrega"], cobro)

                    try:
                        fecha = normalizar_fecha_sync(item.get("fecha_hora"))
                    except serializers.ValidationError as exc:
                        raise serializers.ValidationError(exc.detail) from exc

                    if dia_ya_cerrado(fecha):
                        raise serializers.ValidationError(
                            {
                                "detail": (
                                    "No se pueden registrar ventas: "
                                    "la caja del día ya está cerrada."
                                )
                            }
                        )

                    for det in item["detalles"]:
                        producto = productos.get(det["producto"].pk)
                        if producto is None:
                            raise serializers.ValidationError(
                                {
                                    "detalles": (
                                        f"Producto id={det['producto'].pk} no existe."
                                    )
                                }
                            )
                        if producto.estado != Producto.Estado.ACTIVO:
                            raise serializers.ValidationError(
                                {
                                    "detalles": (
                                        f"Producto '{producto.nombre}' está inactivo."
                                    )
                                }
                            )

                    venta = Venta.objects.create(
                        client_uuid=item["client_uuid"],
                        cajero=usuario,
                        fecha_hora=fecha,
                        metodo_pago=item["metodo_pago"],
                        tipo_entrega=item["tipo_entrega"],
                        cobro_delivery=cobro,
                        estado=Venta.Estado.COMPLETADA,
                        notas=item.get("notas") or "",
                        total=Decimal("0.00"),
                    )

                    total_detalles = Decimal("0.00")
                    for det in item["detalles"]:
                        producto = productos[det["producto"].pk]
                        cantidad = det["cantidad"]
                        subtotal = (producto.precio * cantidad).quantize(
                            Decimal("0.01")
                        )
                        DetalleVenta.objects.create(
                            venta=venta,
                            producto=producto,
                            cantidad=cantidad,
                            subtotal=subtotal,
                            notas=det.get("notas") or "",
                        )
                        total_detalles += subtotal

                    venta.total = total_detalles + cobro
                    venta.save(update_fields=["total"])
                    creadas.append(
                        {
                            "id": venta.id,
                            "client_uuid": uuid_str,
                            "total": str(venta.total),
                        }
                    )
            except IntegrityError:
                omitidas.append(uuid_str)
            except serializers.ValidationError as exc:
                rechazadas.append(
                    {"client_uuid": uuid_str, "motivo": _motivo_validacion(exc)}
                )

        partes = [f"Sincronizadas {len(creadas)} venta(s)."]
        if rechazadas:
            partes.append(f"{len(rechazadas)} rechazada(s).")
        return {
            "creadas": creadas,
            "omitidas_idempotentes": omitidas,
            "rechazadas": rechazadas,
            "mensaje": " ".join(partes),
        }


class CajaDiariaViewSet(
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    mixins.ListModelMixin,
    viewsets.GenericViewSet,
):
    """
    Cierre de caja diario — solo Administrador.
    Al crear, calcula totales desde ventas Completadas de la fecha.
    """

    queryset = CajaDiaria.objects.select_related("usuario_cierre").all()
    permission_classes = [EsAdministrador]

    def get_serializer_class(self):
        if self.action == "create":
            return CajaDiariaCierreSerializer
        return CajaDiariaSerializer

    def create(self, request, *args, **kwargs):
        serializer = CajaDiariaCierreSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        fecha = serializer.validated_data["fecha"]

        if CajaDiaria.objects.filter(fecha=fecha).exists():
            return Response(
                {"detail": f"Ya existe un cierre de caja para {fecha}."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        totales = _totales_caja_para_fecha(fecha)

        try:
            caja = CajaDiaria.objects.create(
                fecha=fecha,
                total_efectivo=totales["total_efectivo"],
                total_tarjetas=totales["total_tarjetas"],
                total_transferencias=totales["total_transferencias"],
                total_webpay=totales["total_webpay"],
                usuario_cierre=request.user,
            )
        except IntegrityError:
            return Response(
                {"detail": f"Ya existe un cierre de caja para {fecha}."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(
            CajaDiariaSerializer(caja).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=False, methods=["get"], url_path="preview")
    def preview(self, request):
        """
        Vista previa del cierre sin persistir.
        Query param: ?fecha=YYYY-MM-DD (default: hoy en TZ del local).
        """
        fecha_str = request.query_params.get("fecha")
        if fecha_str:
            from datetime import date

            try:
                fecha = date.fromisoformat(fecha_str)
            except ValueError:
                return Response(
                    {"detail": "Formato de fecha inválido. Use YYYY-MM-DD."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        else:
            fecha = timezone.localdate()

        totales = _totales_caja_para_fecha(fecha)
        data = {
            "fecha": fecha,
            "total_efectivo": totales["total_efectivo"],
            "total_tarjetas": totales["total_tarjetas"],
            "total_transferencias": totales["total_transferencias"],
            "total_webpay": totales["total_webpay"],
            "cantidad_ventas": totales["cantidad_ventas"],
        }
        data["total_general"] = (
            data["total_efectivo"]
            + data["total_tarjetas"]
            + data["total_transferencias"]
            + data["total_webpay"]
        )
        return Response(data)


def _parse_fecha_query(request):
    fecha_str = request.query_params.get("fecha")
    if not fecha_str:
        return timezone.localdate()
    from datetime import date

    try:
        return date.fromisoformat(fecha_str)
    except ValueError as exc:
        raise serializers.ValidationError(
            {"detail": "Formato de fecha inválido. Use YYYY-MM-DD."}
        ) from exc


class ReporteDiarioView(APIView):
    """
    Reporte operativo del día — solo Administrador.
    GET /api/reportes/diario/?fecha=YYYY-MM-DD
    """

    permission_classes = [EsAdministrador]

    def get(self, request, *args, **kwargs):
        try:
            fecha = _parse_fecha_query(request)
        except serializers.ValidationError as exc:
            return Response(exc.detail, status=status.HTTP_400_BAD_REQUEST)

        ventas_dia = Venta.objects.filter(fecha_hora__date=fecha)
        completadas = ventas_dia.filter(estado=Venta.Estado.COMPLETADA)
        anuladas = ventas_dia.filter(estado=Venta.Estado.ANULADA)

        por_producto = list(
            DetalleVenta.objects.filter(venta__in=completadas)
            .values(nombre=F("producto__nombre"))
            .annotate(
                cantidad=Sum("cantidad"),
                monto=Sum("subtotal"),
            )
            .order_by("-cantidad", "nombre")
        )

        for row in por_producto:
            row["monto"] = str(row["monto"] or Decimal("0.00"))

        total_efectivo = _suma_metodo(completadas, Venta.MetodoPago.EFECTIVO)
        total_tarjetas = _suma_metodo(completadas, Venta.MetodoPago.TARJETA)
        total_transferencias = _suma_metodo(
            completadas, Venta.MetodoPago.TRANSFERENCIA
        )
        total_webpay = _suma_metodo(completadas, Venta.MetodoPago.WEBPAY)
        total_general = (
            total_efectivo + total_tarjetas + total_transferencias + total_webpay
        )

        por_entrega = {
            "retiro": completadas.filter(
                tipo_entrega=Venta.TipoEntrega.RETIRO
            ).count(),
            "delivery": completadas.filter(
                tipo_entrega=Venta.TipoEntrega.DELIVERY
            ).count(),
        }

        return Response(
            {
                "fecha": fecha,
                "cantidad_ventas": completadas.count(),
                "cantidad_anuladas": anuladas.count(),
                "total_efectivo": str(total_efectivo),
                "total_tarjetas": str(total_tarjetas),
                "total_transferencias": str(total_transferencias),
                "total_webpay": str(total_webpay),
                "total_general": str(total_general),
                "por_entrega": por_entrega,
                "por_producto": por_producto,
            }
        )


class CartaView(APIView):
    """Carta pública de productos activos para pedidos web."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        qs = Producto.objects.filter(estado=Producto.Estado.ACTIVO).order_by(
            "categoria", "nombre"
        )
        return Response(CartaProductoSerializer(qs, many=True).data)


class PedidoRetornoView(APIView):
    """
    Retorno de Webpay.
    - token_ws: commit; si AUTHORIZED → venta + redirect ok
    - TBK_TOKEN: cliente anuló en Webpay → rechazado
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        return self._manejar(request)

    def post(self, request):
        return self._manejar(request)

    def _manejar(self, request):
        data = request.data if request.method == "POST" else request.query_params
        token_ws = data.get("token_ws") or ""
        tbk_token = data.get("TBK_TOKEN") or ""

        if tbk_token and not token_ws:
            pedido = Pedido.objects.filter(webpay_token=tbk_token).first()
            if pedido:
                marcar_pedido_rechazado(pedido)
            return redirect(
                _frontend_pedir_redirect(
                    {
                        "pago": "anulado",
                        "pedido": pedido.pk if pedido else "",
                    }
                )
            )

        if not token_ws:
            return redirect(_frontend_pedir_redirect({"pago": "error"}))

        pedido = Pedido.objects.filter(webpay_token=token_ws).first()
        if pedido is None:
            return redirect(_frontend_pedir_redirect({"pago": "error"}))

        # Idempotencia: ya confirmado
        if pedido.estado == Pedido.Estado.PAGADO and pedido.venta_id:
            return redirect(
                _frontend_pedir_redirect(
                    {"pago": "ok", "pedido": pedido.pk, "venta": pedido.venta_id}
                )
            )

        try:
            commit = webpay.commit_transaction(token_ws)
        except Exception:  # noqa: BLE001
            marcar_pedido_rechazado(pedido)
            return redirect(
                _frontend_pedir_redirect({"pago": "rechazado", "pedido": pedido.pk})
            )

        if (commit.status or "").upper() == "AUTHORIZED":
            try:
                confirmar_pago_autorizado(pedido, commit)
            except serializers.ValidationError:
                marcar_pedido_rechazado(pedido)
                return redirect(
                    _frontend_pedir_redirect(
                        {"pago": "error", "pedido": pedido.pk}
                    )
                )
            pedido.refresh_from_db()
            return redirect(
                _frontend_pedir_redirect(
                    {
                        "pago": "ok",
                        "pedido": pedido.pk,
                        "venta": pedido.venta_id or "",
                    }
                )
            )

        marcar_pedido_rechazado(pedido)
        return redirect(
            _frontend_pedir_redirect({"pago": "rechazado", "pedido": pedido.pk})
        )


class PedidoViewSet(
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    mixins.ListModelMixin,
    viewsets.GenericViewSet,
):
    """
    Pedidos web.
    - POST (público): crea pedido e inicia Webpay.
    - GET list (auth): solo pagados pendientes de recepción.
    - POST {id}/recibir/ (auth): marca recibido en cocina.
    """

    serializer_class = PedidoSerializer
    http_method_names = ["get", "post", "head", "options"]
    queryset = Pedido.objects.prefetch_related("detalles__producto").select_related(
        "venta"
    )

    def get_permissions(self):
        if self.action == "create":
            return [AllowAny()]
        return [EsCajeroOAdministrador()]

    def get_throttles(self):
        if self.action == "create":
            return [PedidosAnonThrottle()]
        return super().get_throttles()

    def get_queryset(self):
        qs = super().get_queryset()
        if self.action == "list":
            return qs.filter(estado=Pedido.Estado.PAGADO)
        return qs

    def create(self, request, *args, **kwargs):
        serializer = PedidoCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        pedido = crear_pedido_desde_payload(serializer.validated_data)
        return_url = f"{settings.PUBLIC_API_BASE_URL}/api/pedidos/retorno/"
        try:
            pago = iniciar_pago_webpay(pedido, return_url)
        except Exception as exc:  # noqa: BLE001
            marcar_pedido_rechazado(pedido)
            return Response(
                {"detail": f"No se pudo iniciar el pago con Webpay: {exc}"},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        return Response(
            {
                "pedido_id": pago["pedido_id"],
                "token": pago["token"],
                "url": pago["url"],
                "total": str(pedido.total),
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="recibir")
    def recibir(self, request, pk=None):
        pedido = self.get_object()
        if pedido.estado != Pedido.Estado.PAGADO:
            return Response(
                {"detail": "Solo se pueden recibir pedidos pagados."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        pedido.estado = Pedido.Estado.RECIBIDO
        pedido.save(update_fields=["estado", "actualizado_en"])
        return Response(PedidoSerializer(pedido).data)
