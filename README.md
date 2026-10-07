# El Tenedor — Backend MVP (Django + DRF) + PWA

API REST y Progressive Web App del punto de venta interno de **El Tenedor** (Punta Arenas): ventas/caja, inventario, roles y sincronización offline.

Documentación de consultas a IA (seguridad JWT, CORS, variables de entorno y revisión REST): **[SECURITY_PROMPTS.md](SECURITY_PROMPTS.md)**.

Informe técnico para la evaluación: **[Informe_técnico_BackEnd.pdf](Informe_técnico_BackEnd.pdf)**.

## Aplicación publicada

Vista del usuario final:

| Qué | URL |
|-----|-----|
| POS (caja) | https://el-tenedor.mrjslvsnchz.workers.dev/ |
| Pedidos del cliente | https://el-tenedor.mrjslvsnchz.workers.dev/pedir |

La página está en Cloudflare. La API está en Azure.

Repositorio: https://github.com/MariaJoseSS20/el-tenedor

## Arranque local

```bash
cd el-tenedor
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python manage.py migrate
python manage.py seed_menu
python manage.py runserver 8003
```

`.venv/` no se sube a Git (está en `.gitignore`). Las claves reales van en `.env`, nunca en el repositorio. La plantilla sin secretos es `.env.example`.

Usuarios demo (tras `seed_menu` en local, con `DEBUG=True`):

| Usuario  | Password   | Rol            |
|----------|------------|----------------|
| admin    | admin123   | Administrador  |
| cajero1  | cajero123  | Cajero         |

El frontend Vite proxea `/api` a `http://127.0.0.1:8003`.

Tests:

```bash
source .venv/bin/activate
python manage.py test pos
```

### Endpoints

Prefijo oficial: **`/api/v1/`**. Las mismas rutas responden también en `/api/` para la PWA ya publicada.

| Método | Ruta | Quién |
|--------|------|--------|
| POST | `/api/v1/token/` | Login JWT |
| POST | `/api/v1/token/refresh/` | Refresh JWT |
| POST | `/api/v1/registro/` | Registro público (crea cajero + JWT) |
| GET | `/api/v1/me/` | Usuario autenticado |
| GET | `/api/v1/carta/` | Público. Productos activos |
| GET | `/api/v1/horario-pedidos/` | Público. Si la carta acepta pedidos ahora |
| GET/PUT/PATCH | `/api/v1/horario-pedidos/config/` | Lectura: cajero y admin. Escritura: admin |
| GET | `/api/v1/zonas-delivery/publicas/` | Público |
| GET/POST/PUT/PATCH/DELETE | `/api/v1/zonas-delivery/` | Lectura: autenticados. Escritura: admin |
| POST | `/api/v1/pedidos/` | Público. Crea pedido e inicia Webpay |
| GET | `/api/v1/pedidos/` | Cajero y admin. Pedidos pagados |
| POST | `/api/v1/pedidos/{id}/recibir/` | Cajero y admin |
| GET/POST | `/api/v1/pedidos/retorno/` | Retorno de Webpay |
| GET/POST/PUT/PATCH/DELETE | `/api/v1/productos/` | Lectura: autenticados. Escritura: admin. Paginado |
| GET/POST/PUT/PATCH/DELETE | `/api/v1/inventario/` | Lectura: autenticados. Escritura: admin. Paginado |
| GET/POST | `/api/v1/ventas/` | Cajero y admin. Listado paginado |
| PUT/PATCH | `/api/v1/ventas/{id}/` | Anular con `{"estado":"anulada"}`. Solo admin |
| DELETE | `/api/v1/ventas/{id}/` | Responde 405. La venta no se borra |
| POST | `/api/v1/sync-ventas/` | Cajero y admin. Lote offline |
| GET/POST | `/api/v1/caja-diaria/` | Solo admin. Listado paginado |
| GET | `/api/v1/caja-diaria/preview/` | Solo admin |
| GET | `/api/v1/reportes/diario/?fecha=YYYY-MM-DD` | Solo admin |

## 2. Frontend PWA

En otra terminal:

```bash
cd el-tenedor/frontend
npm install
npm run dev
```

Abre http://127.0.0.1:5180/

Vite hace proxy de `/api` → `http://127.0.0.1:8003`.

### Offline

- Sin internet, al cobrar se guarda la venta en **IndexedDB**.
- Al recuperar señal (o con el botón **Sincronizar**), se envía el lote a `/api/sync-ventas/`.
