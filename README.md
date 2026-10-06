# El Tenedor — Backend MVP (Django + DRF) + PWA

API REST y Progressive Web App del punto de venta interno de **El Tenedor** (Punta Arenas): ventas/caja, inventario, roles y sincronización offline.

Documentación de consultas a IA (seguridad JWT + code review REST): **[SECURITY_PROMPTS.md](SECURITY_PROMPTS.md)**.

## Arranque local

Ver también: **[DEPLOY_GRATIS.md](DEPLOY_GRATIS.md)** para publicarlo gratis en internet.

Según la guía del curso (sin `venv`), se pueden instalar las librerías en el entorno de trabajo:

```bash
pip install -r requirements.txt
```

En este repo también se usa `./vendor` (útil si no querés mezclar con otros proyectos):

```bash
cd el-tenedor
python3 -m pip install --target ./vendor -r requirements.txt
python3 manage.py migrate
python3 manage.py seed_menu
python3 manage.py runserver 8003
```

Usuarios demo (tras `seed_menu` en local, con `DEBUG=True`):

| Usuario  | Password   | Rol            |
|----------|------------|----------------|
| admin    | admin123   | Administrador  |
| cajero1  | cajero123  | Cajero         |

> Si el puerto 8001 ya lo usa otro proyecto, usá **8003** (como arriba). El frontend Vite proxea `/api` a ese puerto.

Tests:

```bash
python3 manage.py test pos
```

### Endpoints

| Método | Ruta | Quién |
|--------|------|--------|
| POST | `/api/token/` | Login JWT |
| POST | `/api/token/refresh/` | Refresh JWT |
| POST | `/api/registro/` | Registro público (crea cajero + JWT). Pantalla **Registrarse** en el login del POS |
| GET | `/api/me/` | Usuario autenticado |
| GET/POST… | `/api/productos/` | GET todos · escritura Admin · paginado |
| GET/PATCH | `/api/inventario/` | GET todos · escritura Admin · paginado |
| GET/POST | `/api/ventas/` | Cajero y Admin · listado paginado |
| PATCH | `/api/ventas/{id}/` `{"estado":"anulada"}` | Solo Admin (no hay DELETE) |
| POST | `/api/sync-ventas/` | Lote offline |
| GET/POST | `/api/caja-diaria/` | Solo Admin · listado paginado |
| GET | `/api/reportes/diario/?fecha=YYYY-MM-DD` | Solo Admin |

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
