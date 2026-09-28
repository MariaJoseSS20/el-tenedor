"""
Tests del MVP El Tenedor: roles, ventas, sync offline, anulación y caja.
Sin control de stock (inventario es catálogo 1:1).
"""

import uuid
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from pos.models import CajaDiaria, CustomUser, Producto, Venta


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

    def test_sync_falla_producto_inactivo_y_no_guarda_nada(self):
        self.producto.estado = Producto.Estado.INACTIVO
        self.producto.save(update_fields=["estado"])
        self.auth(self.cajero)
        lote = self._lote(1)
        r = self.client.post("/api/sync-ventas/", lote, format="json")
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Venta.objects.count(), 0)

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
        self.client.post(
            "/api/ventas/",
            {
                "metodo_pago": "tarjeta",
                "tipo_entrega": "delivery",
                "cobro_delivery": "1500",
                "detalles": [{"producto": self.producto.id, "cantidad": 1}],
            },
            format="json",
        )

        self.auth(self.admin)
        fecha = str(timezone.localdate())
        r = self.client.post("/api/caja-diaria/", {"fecha": fecha}, format="json")
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Decimal(r.data["total_efectivo"]), Decimal("5000.00"))
        self.assertEqual(Decimal(r.data["total_tarjetas"]), Decimal("6500.00"))
        self.assertTrue(CajaDiaria.objects.filter(fecha=fecha).exists())


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
