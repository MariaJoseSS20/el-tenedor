"""
Tests del MVP El Tenedor: roles, ventas, sync offline, anulación y caja.
Sin control de stock (inventario es catálogo 1:1).
"""

import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from unittest.mock import patch
from zoneinfo import ZoneInfo

from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from pos.horario_pedidos import MENSAJE_CERRADO, estado_pedidos_web
from pos.models import CajaDiaria, CustomUser, Inventario, Producto, Venta, ZonaDelivery


class BaseAPITest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = CustomUser.objects.create_user(
            username="admin_test",
            password="pass1234",
            rol=CustomUser.Rol.ADMINISTRADOR,
        )
        self.cajero = CustomUser.objects.create_user(
            username="cajero_test",
            password="pass1234",
            rol=CustomUser.Rol.CAJERO,
        )
        self.producto = Producto.objects.create(
            nombre="Roll Test",
            precio=Decimal("5000.00"),
            categoria=Producto.Categoria.SUSHI,
        )

    def auth(self, user):
        self.client.force_authenticate(user=user)


class RolesYVentasTests(BaseAPITest):
    def test_cajero_no_puede_crear_producto(self):
        self.auth(self.cajero)
        r = self.client.post(
            "/api/productos/",
            {
                "nombre": "X",
                "precio": "1000",
                "categoria": "sushi",
            },
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_403_FORBIDDEN)

    def test_cajero_crea_venta(self):
        self.auth(self.cajero)
        r = self.client.post(
            "/api/ventas/",
            {
                "metodo_pago": "efectivo",
                "tipo_entrega": "retiro",
                "cobro_delivery": "0",
                "detalles": [{"producto": self.producto.id, "cantidad": 2}],
            },
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Decimal(r.data["total"]), Decimal("10000.00"))
        self.assertEqual(r.data["cajero"]["username"], "cajero_test")

    def test_cajero_no_puede_anular(self):
        self.auth(self.cajero)
        venta = self.client.post(
            "/api/ventas/",
            {
                "metodo_pago": "tarjeta",
                "tipo_entrega": "retiro",
                "cobro_delivery": "0",
                "detalles": [{"producto": self.producto.id, "cantidad": 1}],
            },
            format="json",
        ).data
        r = self.client.patch(
            f"/api/ventas/{venta['id']}/",
            {"estado": "anulada"},
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_anula_venta(self):
        self.auth(self.cajero)
        venta = self.client.post(
            "/api/ventas/",
            {
                "metodo_pago": "efectivo",
                "tipo_entrega": "retiro",
                "cobro_delivery": "0",
                "detalles": [{"producto": self.producto.id, "cantidad": 3}],
            },
            format="json",
        ).data

        self.auth(self.admin)
        r = self.client.patch(
            f"/api/ventas/{venta['id']}/",
            {"estado": "anulada"},
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertEqual(r.data["estado"], "anulada")

    def test_no_se_puede_borrar_venta(self):
        self.auth(self.cajero)
        venta = self.client.post(
            "/api/ventas/",
            {
                "metodo_pago": "efectivo",
                "tipo_entrega": "retiro",
                "cobro_delivery": "0",
                "detalles": [{"producto": self.producto.id, "cantidad": 1}],
            },
            format="json",
        ).data

        self.auth(self.admin)
        r = self.client.delete(f"/api/ventas/{venta['id']}/")
        self.assertEqual(r.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
        self.assertTrue(Venta.objects.filter(pk=venta["id"]).exists())

    def test_cantidad_cero_rechazada(self):
        self.auth(self.cajero)
        r = self.client.post(
            "/api/ventas/",
            {
                "metodo_pago": "efectivo",
                "tipo_entrega": "retiro",
                "cobro_delivery": "0",
                "detalles": [{"producto": self.producto.id, "cantidad": 0}],
            },
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Venta.objects.count(), 0)

    def test_precio_negativo_rechazado(self):
        self.auth(self.admin)
        r = self.client.post(
            "/api/productos/",
            {
                "nombre": "Malo",
                "precio": "-1000",
                "categoria": "agregados",
            },
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_precio_cero_rechazado(self):
        self.auth(self.admin)
        r = self.client.post(
            "/api/productos/",
            {
                "nombre": "Gratis",
                "precio": "0",
                "categoria": "agregados",
            },
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_fecha_hora_cliente_ignorada_en_venta_online(self):
        self.auth(self.cajero)
        ayer = (timezone.now() - timedelta(days=3)).isoformat()
        antes = timezone.now()
        r = self.client.post(
            "/api/ventas/",
            {
                "metodo_pago": "efectivo",
                "tipo_entrega": "retiro",
                "cobro_delivery": "0",
                "fecha_hora": ayer,
                "detalles": [{"producto": self.producto.id, "cantidad": 1}],
            },
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        venta = Venta.objects.get(pk=r.data["id"])
        self.assertGreaterEqual(venta.fecha_hora, antes - timedelta(seconds=5))
        self.assertNotEqual(
            timezone.localtime(venta.fecha_hora).date(),
            (timezone.now() - timedelta(days=3)).date(),
        )


class SyncOfflineTests(BaseAPITest):
    def _lote(self, *cantidades):
        items = []
        for cantidad in cantidades:
            items.append(
                {
                    "client_uuid": str(uuid.uuid4()),
                    "metodo_pago": "efectivo",
                    "tipo_entrega": "retiro",
                    "cobro_delivery": "0",
                    "detalles": [{"producto": self.producto.id, "cantidad": cantidad}],
                }
            )
        return items

    def test_sync_lote_atomico_e_idempotente(self):
        self.auth(self.cajero)
        lote = self._lote(2, 3)
        r = self.client.post("/api/sync-ventas/", lote, format="json")
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        self.assertEqual(len(r.data["creadas"]), 2)

        r2 = self.client.post("/api/sync-ventas/", lote, format="json")
        self.assertEqual(r2.status_code, status.HTTP_201_CREATED)
        self.assertEqual(len(r2.data["creadas"]), 0)
        self.assertEqual(len(r2.data["omitidas_idempotentes"]), 2)
        self.assertEqual(Venta.objects.count(), 2)

    def test_sync_producto_inactivo_va_a_rechazadas(self):
        self.producto.estado = Producto.Estado.INACTIVO
        self.producto.save(update_fields=["estado"])
        self.auth(self.cajero)
        lote = self._lote(1)
        r = self.client.post("/api/sync-ventas/", lote, format="json")
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        self.assertEqual(len(r.data["creadas"]), 0)
        self.assertEqual(len(r.data["rechazadas"]), 1)
        self.assertEqual(Venta.objects.count(), 0)

    def test_sync_lote_mixto_una_valida_una_inactiva(self):
        inactivo = Producto.objects.create(
            nombre="Inactivo",
            precio=Decimal("1000.00"),
            categoria=Producto.Categoria.AGREGADOS,
            estado=Producto.Estado.INACTIVO,
        )
        self.auth(self.cajero)
        uuid_ok = str(uuid.uuid4())
        uuid_bad = str(uuid.uuid4())
        lote = [
            {
                "client_uuid": uuid_ok,
                "metodo_pago": "efectivo",
                "tipo_entrega": "retiro",
                "cobro_delivery": "0",
                "detalles": [{"producto": self.producto.id, "cantidad": 1}],
            },
            {
                "client_uuid": uuid_bad,
                "metodo_pago": "efectivo",
                "tipo_entrega": "retiro",
                "cobro_delivery": "0",
                "detalles": [{"producto": inactivo.id, "cantidad": 1}],
            },
        ]
        r = self.client.post("/api/sync-ventas/", lote, format="json")
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        self.assertEqual(len(r.data["creadas"]), 1)
        self.assertEqual(r.data["creadas"][0]["client_uuid"], uuid_ok)
        self.assertEqual(len(r.data["rechazadas"]), 1)
        self.assertEqual(r.data["rechazadas"][0]["client_uuid"], uuid_bad)
        self.assertEqual(Venta.objects.count(), 1)

    def test_sync_idempotente_si_uuid_ya_existe(self):
        """Simula carrera: UUID ya insertado antes del create del lote."""
        self.auth(self.cajero)
        client_uuid = str(uuid.uuid4())
        Venta.objects.create(
            client_uuid=client_uuid,
            cajero=self.cajero,
            metodo_pago=Venta.MetodoPago.EFECTIVO,
            tipo_entrega=Venta.TipoEntrega.RETIRO,
            cobro_delivery=Decimal("0.00"),
            total=Decimal("5000.00"),
            estado=Venta.Estado.COMPLETADA,
        )
        lote = [
            {
                "client_uuid": client_uuid,
                "metodo_pago": "efectivo",
                "tipo_entrega": "retiro",
                "cobro_delivery": "0",
                "detalles": [{"producto": self.producto.id, "cantidad": 1}],
            }
        ]
        r = self.client.post("/api/sync-ventas/", lote, format="json")
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        self.assertEqual(len(r.data["creadas"]), 0)
        self.assertEqual(len(r.data["omitidas_idempotentes"]), 1)
        self.assertEqual(Venta.objects.count(), 1)

    def test_sync_retiro_con_delivery_rechazado(self):
        self.auth(self.cajero)
        lote = [
            {
                "client_uuid": str(uuid.uuid4()),
                "metodo_pago": "efectivo",
                "tipo_entrega": "retiro",
                "cobro_delivery": "2500",
                "detalles": [{"producto": self.producto.id, "cantidad": 1}],
            }
        ]
        r = self.client.post("/api/sync-ventas/", lote, format="json")
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        self.assertEqual(len(r.data["creadas"]), 0)
        self.assertEqual(len(r.data["rechazadas"]), 1)
        self.assertEqual(Venta.objects.count(), 0)

    def test_sync_fecha_ayer_rechazada(self):
        self.auth(self.cajero)
        ayer = (timezone.now() - timedelta(days=1)).isoformat()
        lote = [
            {
                "client_uuid": str(uuid.uuid4()),
                "metodo_pago": "efectivo",
                "tipo_entrega": "retiro",
                "cobro_delivery": "0",
                "fecha_hora": ayer,
                "detalles": [{"producto": self.producto.id, "cantidad": 1}],
            }
        ]
        r = self.client.post("/api/sync-ventas/", lote, format="json")
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        self.assertEqual(len(r.data["creadas"]), 0)
        self.assertEqual(len(r.data["rechazadas"]), 1)

    def test_sync_fecha_futura_rechazada(self):
        self.auth(self.cajero)
        futura = (timezone.now() + timedelta(hours=5)).isoformat()
        lote = [
            {
                "client_uuid": str(uuid.uuid4()),
                "metodo_pago": "efectivo",
                "tipo_entrega": "retiro",
                "cobro_delivery": "0",
                "fecha_hora": futura,
                "detalles": [{"producto": self.producto.id, "cantidad": 1}],
            }
        ]
        r = self.client.post("/api/sync-ventas/", lote, format="json")
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        self.assertEqual(len(r.data["creadas"]), 0)
        self.assertEqual(len(r.data["rechazadas"]), 1)


class CajaDiariaTests(BaseAPITest):
    def test_cajero_no_cierra_caja(self):
        self.auth(self.cajero)
        r = self.client.post(
            "/api/caja-diaria/",
            {"fecha": str(timezone.localdate())},
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_cierra_caja_calculada(self):
        self.auth(self.cajero)
        self.client.post(
            "/api/ventas/",
            {
                "metodo_pago": "efectivo",
                "tipo_entrega": "retiro",
                "cobro_delivery": "0",
                "detalles": [{"producto": self.producto.id, "cantidad": 1}],
            },
            format="json",
        )
        ciudad = ZonaDelivery.objects.get(nombre="Ciudad")
        self.client.post(
            "/api/ventas/",
            {
                "metodo_pago": "tarjeta",
                "tipo_entrega": "delivery",
                "cobro_delivery": "1",
                "zona_delivery": ciudad.id,
                "detalles": [{"producto": self.producto.id, "cantidad": 1}],
            },
            format="json",
        )

        self.auth(self.admin)
        fecha = str(timezone.localdate())
        r = self.client.post("/api/caja-diaria/", {"fecha": fecha}, format="json")
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Decimal(r.data["total_efectivo"]), Decimal("5000.00"))
        self.assertEqual(Decimal(r.data["total_tarjetas"]), Decimal("8500.00"))
        self.assertTrue(CajaDiaria.objects.filter(fecha=fecha).exists())

    def test_venta_rechazada_si_caja_del_dia_cerrada(self):
        self.auth(self.admin)
        fecha = timezone.localdate()
        CajaDiaria.objects.create(
            fecha=fecha,
            total_efectivo=Decimal("0.00"),
            total_tarjetas=Decimal("0.00"),
            total_transferencias=Decimal("0.00"),
            usuario_cierre=self.admin,
        )
        self.auth(self.cajero)
        r = self.client.post(
            "/api/ventas/",
            {
                "metodo_pago": "efectivo",
                "tipo_entrega": "retiro",
                "cobro_delivery": "0",
                "detalles": [{"producto": self.producto.id, "cantidad": 1}],
            },
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Venta.objects.count(), 0)

    def test_anular_recalcula_caja_cerrada(self):
        self.auth(self.cajero)
        venta = self.client.post(
            "/api/ventas/",
            {
                "metodo_pago": "efectivo",
                "tipo_entrega": "retiro",
                "cobro_delivery": "0",
                "detalles": [{"producto": self.producto.id, "cantidad": 1}],
            },
            format="json",
        ).data

        self.auth(self.admin)
        fecha = str(timezone.localdate())
        self.client.post("/api/caja-diaria/", {"fecha": fecha}, format="json")
        caja = CajaDiaria.objects.get(fecha=fecha)
        self.assertEqual(caja.total_efectivo, Decimal("5000.00"))

        r = self.client.patch(
            f"/api/ventas/{venta['id']}/",
            {"estado": "anulada"},
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        caja.refresh_from_db()
        self.assertEqual(caja.total_efectivo, Decimal("0.00"))


class InventarioTests(BaseAPITest):
    def test_admin_crea_y_edita_empaque(self):
        self.auth(self.admin)
        crear = self.client.post(
            "/api/inventario/",
            {"nombre": "Bandejas", "cantidad": 10, "notas": "a"},
            format="json",
        )
        self.assertEqual(crear.status_code, status.HTTP_201_CREATED)
        inv_id = crear.data["id"]

        r = self.client.put(
            f"/api/inventario/{inv_id}/",
            {"nombre": "Bandejas", "cantidad": 8, "notas": "b"},
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        inv = Inventario.objects.get(pk=inv_id)
        self.assertEqual(inv.cantidad, 8)
        self.assertEqual(inv.notas, "b")

    def test_cajero_no_crea_inventario(self):
        self.auth(self.cajero)
        r = self.client.post(
            "/api/inventario/",
            {"nombre": "Cubiertos", "cantidad": 5, "notas": ""},
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_403_FORBIDDEN)


class ReporteDiarioTests(BaseAPITest):
    def test_cajero_no_ve_reporte(self):
        self.auth(self.cajero)
        r = self.client.get("/api/reportes/diario/")
        self.assertEqual(r.status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_reporte_por_producto(self):
        self.auth(self.cajero)
        self.client.post(
            "/api/ventas/",
            {
                "metodo_pago": "efectivo",
                "tipo_entrega": "retiro",
                "cobro_delivery": "0",
                "detalles": [{"producto": self.producto.id, "cantidad": 2}],
            },
            format="json",
        )
        self.auth(self.admin)
        fecha = str(timezone.localdate())
        r = self.client.get(f"/api/reportes/diario/?fecha={fecha}")
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertEqual(r.data["cantidad_ventas"], 1)
        self.assertEqual(Decimal(r.data["total_general"]), Decimal("10000.00"))
        self.assertEqual(len(r.data["por_producto"]), 1)
        self.assertEqual(r.data["por_producto"][0]["nombre"], "Roll Test")
        self.assertEqual(r.data["por_producto"][0]["cantidad"], 2)


class PedidosWebpayTests(BaseAPITest):
    def setUp(self):
        super().setUp()
        from unittest.mock import patch

        self._patcher_create = patch("pos.webpay.create_transaction")
        self._patcher_commit = patch("pos.webpay.commit_transaction")
        self._patcher_refund = patch("pos.webpay.refund_transaction")
        self._patcher_throttle = patch(
            "pos.views.PedidoViewSet.get_throttles", return_value=[]
        )
        self._patcher_horario = patch("pos.views.pedidos_web_abiertos", return_value=True)
        self.mock_create = self._patcher_create.start()
        self.mock_commit = self._patcher_commit.start()
        self.mock_refund = self._patcher_refund.start()
        self._patcher_throttle.start()
        self._patcher_horario.start()
        self.addCleanup(self._patcher_create.stop)
        self.addCleanup(self._patcher_commit.stop)
        self.addCleanup(self._patcher_refund.stop)
        self.addCleanup(self._patcher_throttle.stop)
        self.addCleanup(self._patcher_horario.stop)

        from pos.webpay import WebpayCommitResult, WebpayCreateResult, WebpayRefundResult

        self.mock_create.return_value = WebpayCreateResult(
            token="tok-test-abc",
            url="https://webpay.example/init",
        )
        self.mock_commit.return_value = WebpayCommitResult(
            status="AUTHORIZED",
            authorization_code="AUTH1",
            amount=Decimal("5000"),
            buy_order="Ptest",
            response_code=0,
        )
        self.mock_refund.return_value = WebpayRefundResult(
            type="REVERSED",
            response_code=0,
            authorization_code="R1",
        )

    def _payload(self, **overrides):
        data = {
            "nombre_cliente": "Ana Cliente",
            "telefono": "+56912345678",
            "tipo_entrega": "retiro",
            "direccion": "",
            "notas": "",
            "detalles": [{"producto": self.producto.id, "cantidad": 1}],
        }
        data.update(overrides)
        return data

    def test_anonimo_ve_carta(self):
        r = self.client.get("/api/carta/")
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertEqual(len(r.data), 1)
        self.assertEqual(r.data[0]["nombre"], "Roll Test")
        self.assertNotIn("estado", r.data[0])

    def test_anonimo_no_lista_pedidos_ni_ventas(self):
        self.assertEqual(self.client.get("/api/pedidos/").status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(self.client.get("/api/ventas/").status_code, status.HTTP_401_UNAUTHORIZED)

    def test_crear_pedido_precio_servidor_e_inicia_webpay(self):
        r = self.client.post("/api/pedidos/", self._payload(), format="json")
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        self.assertEqual(r.data["token"], "tok-test-abc")
        self.assertEqual(r.data["url"], "https://webpay.example/init")
        self.assertEqual(Decimal(r.data["total"]), Decimal("5000.00"))
        from pos.models import Pedido

        pedido = Pedido.objects.get(pk=r.data["pedido_id"])
        self.assertEqual(pedido.estado, Pedido.Estado.ESPERANDO_PAGO)
        self.assertEqual(pedido.webpay_token, "tok-test-abc")
        self.mock_create.assert_called_once()

    def test_delivery_sin_direccion_rechazado(self):
        r = self.client.post(
            "/api/pedidos/",
            self._payload(tipo_entrega="delivery", direccion=""),
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_delivery_sin_zona_rechazado(self):
        r = self.client.post(
            "/api/pedidos/",
            self._payload(tipo_entrega="delivery", direccion="Calle 1"),
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_delivery_usa_precio_de_la_zona(self):
        ciudad = ZonaDelivery.objects.get(nombre="Ciudad")
        rural = ZonaDelivery.objects.get(nombre="Rural")
        r = self.client.post(
            "/api/pedidos/",
            self._payload(
                tipo_entrega="delivery",
                direccion="Calle 1",
                zona_delivery=ciudad.id,
                cobro_delivery="1",
            ),
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Decimal(r.data["total"]), Decimal("8500.00"))

        r2 = self.client.post(
            "/api/pedidos/",
            self._payload(
                tipo_entrega="delivery",
                direccion="Camino rural 9",
                zona_delivery=rural.id,
            ),
            format="json",
        )
        self.assertEqual(r2.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Decimal(r2.data["total"]), Decimal("10000.00"))

    def test_pago_autorizado_crea_venta_y_aparece_en_bandeja(self):
        created = self.client.post("/api/pedidos/", self._payload(), format="json").data
        r = self.client.get("/api/pedidos/retorno/", {"token_ws": "tok-test-abc"})
        self.assertEqual(r.status_code, status.HTTP_302_FOUND)
        self.assertIn("pago=ok", r.url)

        from pos.models import Pedido

        pedido = Pedido.objects.get(pk=created["pedido_id"])
        self.assertEqual(pedido.estado, Pedido.Estado.PAGADO)
        self.assertIsNotNone(pedido.venta_id)
        self.assertEqual(pedido.venta.metodo_pago, Venta.MetodoPago.WEBPAY)
        self.assertEqual(pedido.venta.estado, Venta.Estado.COMPLETADA)

        self.auth(self.cajero)
        lista = self.client.get("/api/pedidos/")
        self.assertEqual(lista.status_code, status.HTTP_200_OK)
        ids = [p["id"] for p in lista.data]
        self.assertIn(pedido.id, ids)

    def test_pago_rechazado_no_crea_venta(self):
        from pos.webpay import WebpayCommitResult

        self.mock_commit.return_value = WebpayCommitResult(
            status="FAILED",
            authorization_code="",
            amount=Decimal("0"),
            buy_order="Ptest",
            response_code=-1,
        )
        created = self.client.post("/api/pedidos/", self._payload(), format="json").data
        r = self.client.get("/api/pedidos/retorno/", {"token_ws": "tok-test-abc"})
        self.assertEqual(r.status_code, status.HTTP_302_FOUND)
        self.assertIn("pago=rechazado", r.url)

        from pos.models import Pedido

        pedido = Pedido.objects.get(pk=created["pedido_id"])
        self.assertEqual(pedido.estado, Pedido.Estado.RECHAZADO)
        self.assertIsNone(pedido.venta_id)
        self.assertEqual(Venta.objects.count(), 0)

    def test_anular_en_webpay_con_tbk_token(self):
        created = self.client.post("/api/pedidos/", self._payload(), format="json").data
        r = self.client.get("/api/pedidos/retorno/", {"TBK_TOKEN": "tok-test-abc"})
        self.assertEqual(r.status_code, status.HTTP_302_FOUND)
        self.assertIn("pago=anulado", r.url)
        from pos.models import Pedido

        pedido = Pedido.objects.get(pk=created["pedido_id"])
        self.assertEqual(pedido.estado, Pedido.Estado.RECHAZADO)
        self.assertEqual(Venta.objects.count(), 0)

    def test_confirmar_dos_veces_no_duplica_venta(self):
        created = self.client.post("/api/pedidos/", self._payload(), format="json").data
        self.client.get("/api/pedidos/retorno/", {"token_ws": "tok-test-abc"})
        self.client.get("/api/pedidos/retorno/", {"token_ws": "tok-test-abc"})
        from pos.models import Pedido

        pedido = Pedido.objects.get(pk=created["pedido_id"])
        self.assertEqual(Venta.objects.count(), 1)
        self.assertEqual(pedido.estado, Pedido.Estado.PAGADO)

    def test_cliente_no_impone_precio(self):
        r = self.client.post(
            "/api/pedidos/",
            {
                **self._payload(),
                "detalles": [
                    {
                        "producto": self.producto.id,
                        "cantidad": 1,
                        "subtotal": "1",
                        "precio": "1",
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Decimal(r.data["total"]), Decimal("5000.00"))

    def test_anular_venta_webpay_pide_reembolso(self):
        created = self.client.post("/api/pedidos/", self._payload(), format="json").data
        self.client.get("/api/pedidos/retorno/", {"token_ws": "tok-test-abc"})
        from pos.models import Pedido

        pedido = Pedido.objects.get(pk=created["pedido_id"])
        self.auth(self.admin)
        r = self.client.patch(
            f"/api/ventas/{pedido.venta_id}/",
            {"estado": "anulada"},
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.mock_refund.assert_called_once()
        pedido.venta.refresh_from_db()
        self.assertEqual(pedido.venta.estado, Venta.Estado.ANULADA)

    def test_anular_falla_si_reembolso_rechazado(self):
        from pos.webpay import WebpayRefundResult

        self.mock_refund.return_value = WebpayRefundResult(
            type="FAILED",
            response_code=99,
            authorization_code="",
        )
        created = self.client.post("/api/pedidos/", self._payload(), format="json").data
        self.client.get("/api/pedidos/retorno/", {"token_ws": "tok-test-abc"})
        from pos.models import Pedido

        pedido = Pedido.objects.get(pk=created["pedido_id"])
        self.auth(self.admin)
        r = self.client.patch(
            f"/api/ventas/{pedido.venta_id}/",
            {"estado": "anulada"},
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)
        pedido.venta.refresh_from_db()
        self.assertEqual(pedido.venta.estado, Venta.Estado.COMPLETADA)

    def test_recibir_saca_de_bandeja(self):
        created = self.client.post("/api/pedidos/", self._payload(), format="json").data
        self.client.get("/api/pedidos/retorno/", {"token_ws": "tok-test-abc"})
        self.auth(self.cajero)
        r = self.client.post(f"/api/pedidos/{created['pedido_id']}/recibir/")
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        lista = self.client.get("/api/pedidos/")
        ids = [p["id"] for p in lista.data]
        self.assertNotIn(created["pedido_id"], ids)

    def test_pedido_rechazado_no_suma_caja(self):
        from pos.webpay import WebpayCommitResult

        self.mock_commit.return_value = WebpayCommitResult(
            status="FAILED",
            authorization_code="",
            amount=Decimal("0"),
            buy_order="Px",
            response_code=-1,
        )
        self.client.post("/api/pedidos/", self._payload(), format="json")
        self.client.get("/api/pedidos/retorno/", {"token_ws": "tok-test-abc"})
        self.auth(self.admin)
        preview = self.client.get("/api/caja-diaria/preview/")
        self.assertEqual(preview.data["cantidad_ventas"], 0)
        self.assertEqual(Decimal(preview.data["total_webpay"]), Decimal("0.00"))


class ZonaDeliveryTests(BaseAPITest):
    def test_anonimo_ve_zonas_configuradas(self):
        r = self.client.get("/api/zonas-delivery/publicas/")
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        nombres = [z["nombre"] for z in r.data]
        self.assertEqual(nombres, ["Ciudad", "Rural"])
        ciudad = next(z for z in r.data if z["nombre"] == "Ciudad")
        self.assertEqual(Decimal(ciudad["precio"]), Decimal("3500.00"))

    def test_cajero_no_crea_ni_edita(self):
        self.auth(self.cajero)
        r = self.client.post(
            "/api/zonas-delivery/",
            {"nombre": "Nueva", "precio": "1000"},
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_crea_edita_y_elimina(self):
        self.auth(self.admin)
        r = self.client.post(
            "/api/zonas-delivery/",
            {
                "nombre": "Norte",
                "descripcion": "Hasta el río",
                "precio": "4200",
            },
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        zona_id = r.data["id"]

        edit = self.client.patch(
            f"/api/zonas-delivery/{zona_id}/",
            {"precio": "4500"},
            format="json",
        )
        self.assertEqual(edit.status_code, status.HTTP_200_OK)
        self.assertEqual(Decimal(edit.data["precio"]), Decimal("4500.00"))

        deleted = self.client.delete(f"/api/zonas-delivery/{zona_id}/")
        self.assertEqual(deleted.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(ZonaDelivery.objects.filter(pk=zona_id).exists())

    def test_eliminar_zona_usada_conserva_el_pedido(self):
        from pos.models import Pedido

        zona = ZonaDelivery.objects.get(nombre="Ciudad")
        pedido = Pedido.objects.create(
            nombre_cliente="Ana",
            telefono="+56912345678",
            tipo_entrega=Venta.TipoEntrega.DELIVERY,
            direccion="Calle 1",
            cobro_delivery=zona.precio,
            total=zona.precio,
            buy_order="Pzonatest00000000000001",
            zona_delivery=zona,
            zona_nombre=zona.nombre,
            zona_descripcion=zona.descripcion,
        )
        self.auth(self.admin)
        r = self.client.delete(f"/api/zonas-delivery/{zona.id}/")
        self.assertEqual(r.status_code, status.HTTP_204_NO_CONTENT)
        pedido.refresh_from_db()
        self.assertIsNone(pedido.zona_delivery_id)
        self.assertEqual(pedido.zona_nombre, "Ciudad")
        self.assertEqual(pedido.cobro_delivery, Decimal("3500.00"))


class HorarioPedidosTests(BaseAPITest):
    TZ = ZoneInfo("America/Punta_Arenas")

    def _local(self, y, m, d, hh, mm):
        return datetime(y, m, d, hh, mm, tzinfo=self.TZ)

    def test_abierto_en_ventana_almuerzo(self):
        # Lunes 12:00
        estado = estado_pedidos_web(self._local(2026, 10, 5, 12, 0))
        self.assertTrue(estado["abierto"])

    def test_abierto_hasta_fin_ventana(self):
        estado = estado_pedidos_web(self._local(2026, 10, 5, 15, 45))
        self.assertTrue(estado["abierto"])
        estado = estado_pedidos_web(self._local(2026, 10, 5, 15, 46))
        self.assertFalse(estado["abierto"])

    def test_cerrado_entre_turnos(self):
        estado = estado_pedidos_web(self._local(2026, 10, 5, 16, 30))
        self.assertFalse(estado["abierto"])

    def test_abierto_noche(self):
        estado = estado_pedidos_web(self._local(2026, 10, 5, 20, 0))
        self.assertTrue(estado["abierto"])

    def test_cerrado_domingo(self):
        # Domingo 13:00
        estado = estado_pedidos_web(self._local(2026, 10, 4, 13, 0))
        self.assertFalse(estado["abierto"])
        self.assertEqual(estado["mensaje"], MENSAJE_CERRADO)

    def test_endpoint_publico_horario(self):
        r = self.client.get("/api/horario-pedidos/")
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertIn("abierto", r.data)
        self.assertIn("horario", r.data)

    def test_crear_pedido_fuera_de_horario_rechazado(self):
        with patch("pos.views.pedidos_web_abiertos", return_value=False):
            with patch(
                "pos.views.estado_pedidos_web",
                return_value={"mensaje": MENSAJE_CERRADO, "abierto": False},
            ):
                r = self.client.post(
                    "/api/pedidos/",
                    {
                        "nombre_cliente": "Ana",
                        "telefono": "+56912345678",
                        "tipo_entrega": "retiro",
                        "detalles": [{"producto": self.producto.id, "cantidad": 1}],
                    },
                    format="json",
                )
        self.assertEqual(r.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn("no recibimos pedidos", r.data["detail"].lower())

    def test_admin_puede_editar_horario(self):
        self.auth(self.admin)
        r = self.client.get("/api/horario-pedidos/config/")
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertTrue(r.data["habilitado"])
        patch = self.client.patch(
            "/api/horario-pedidos/config/",
            {"domingo": True, "habilitado": False},
            format="json",
        )
        self.assertEqual(patch.status_code, status.HTTP_200_OK)
        self.assertTrue(patch.data["domingo"])
        self.assertFalse(patch.data["habilitado"])
        estado = self.client.get("/api/horario-pedidos/")
        self.assertFalse(estado.data["abierto"])

    def test_cajero_no_edita_horario(self):
        self.auth(self.cajero)
        r = self.client.patch(
            "/api/horario-pedidos/config/",
            {"habilitado": False},
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_403_FORBIDDEN)

