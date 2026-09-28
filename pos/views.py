"""
Vistas API — El Tenedor.

Incluye ViewSets REST y el endpoint crítico de sincronización offline
POST /api/sync-ventas/ con transaction.atomic e idempotencia por client_uuid.
Sin descuento de stock: el inventario se gestiona aparte.
Las ventas no se borran: solo se anulan (auditoría de caja).
"""

from decimal import Decimal

from django.db import IntegrityError, transaction
from django.db.models import F, Sum
from django.utils import timezone
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import CajaDiaria, DetalleVenta, Inventario, Producto, Venta
from .permissions import (
    EsAdministrador,
    LecturaTodosEscrituraAdmin,
    PermisoVentas,
)
from .serializers import (
    CajaDiariaCierreSerializer,
    CajaDiariaSerializer,
    CustomUserSerializer,
    InventarioSerializer,
    ProductoSerializer,
    SyncVentasSerializer,
    VentaSerializer,
)


def _suma_metodo(ventas_qs, metodo):
    return ventas_qs.filter(metodo_pago=metodo).aggregate(t=Sum("total"))[
        "t"
    ] or Decimal("0.00")


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

        venta.estado = Venta.Estado.ANULADA
        venta.save(update_fields=["estado"])

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
    - transaction.atomic: si falla una venta del lote, no se persiste nada.
    - Valida productos activos del lote.
    - Idempotencia: client_uuid ya existentes se omiten (no duplican).
    - Permisos: cajero y administrador autenticados (JWT).
    """

    permission_classes = [PermisoVentas]

    def post(self, request, *args, **kwargs):
        serializer = SyncVentasSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ventas_data = serializer.validated_data["ventas"]

        try:
            resultado = self._procesar_lote(request.user, ventas_data)
        except serializers.ValidationError as exc:
            return Response(exc.detail, status=status.HTTP_400_BAD_REQUEST)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(resultado, status=status.HTTP_201_CREATED)

    def _procesar_lote(self, usuario, ventas_data):
        uuids = [item["client_uuid"] for item in ventas_data]
        existentes = set(
            Venta.objects.filter(client_uuid__in=uuids).values_list(
                "client_uuid", flat=True
            )
        )

        pendientes = [
            item for item in ventas_data if item["client_uuid"] not in existentes
        ]
        omitidas = [
            str(item["client_uuid"])
            for item in ventas_data
            if item["client_uuid"] in existentes
        ]

        if not pendientes:
            return {
                "creadas": [],
                "omitidas_idempotentes": omitidas,
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

        errores = []
        for producto_id in producto_ids:
            producto = productos.get(producto_id)
            if producto is None:
                errores.append(f"Producto id={producto_id} no existe.")
            elif producto.estado != Producto.Estado.ACTIVO:
                errores.append(f"Producto '{producto.nombre}' está inactivo.")

        if errores:
            raise serializers.ValidationError({"productos": errores})

        creadas = []

        with transaction.atomic():
            for item in pendientes:
                try:
                    with transaction.atomic():
                        cobro = item.get("cobro_delivery") or Decimal("0.00")
                        fecha = item.get("fecha_hora") or timezone.now()

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
                                "client_uuid": str(venta.client_uuid),
                                "total": str(venta.total),
                            }
                        )
                except IntegrityError:
                    # Carrera: otro sync insertó el mismo client_uuid.
                    omitidas.append(str(item["client_uuid"]))

        return {
            "creadas": creadas,
            "omitidas_idempotentes": omitidas,
            "mensaje": f"Sincronizadas {len(creadas)} venta(s).",
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

        ventas = Venta.objects.filter(
            fecha_hora__date=fecha,
            estado=Venta.Estado.COMPLETADA,
        )

        try:
            caja = CajaDiaria.objects.create(
                fecha=fecha,
                total_efectivo=_suma_metodo(ventas, Venta.MetodoPago.EFECTIVO),
                total_tarjetas=_suma_metodo(ventas, Venta.MetodoPago.TARJETA),
                total_transferencias=_suma_metodo(
                    ventas, Venta.MetodoPago.TRANSFERENCIA
                ),
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

        ventas = Venta.objects.filter(
            fecha_hora__date=fecha,
            estado=Venta.Estado.COMPLETADA,
        )

        data = {
            "fecha": fecha,
            "total_efectivo": _suma_metodo(ventas, Venta.MetodoPago.EFECTIVO),
            "total_tarjetas": _suma_metodo(ventas, Venta.MetodoPago.TARJETA),
            "total_transferencias": _suma_metodo(
                ventas, Venta.MetodoPago.TRANSFERENCIA
            ),
            "cantidad_ventas": ventas.count(),
        }
        data["total_general"] = (
            data["total_efectivo"]
            + data["total_tarjetas"]
            + data["total_transferencias"]
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
        total_general = total_efectivo + total_tarjetas + total_transferencias

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
                "total_general": str(total_general),
                "por_entrega": por_entrega,
                "por_producto": por_producto,
            }
        )
