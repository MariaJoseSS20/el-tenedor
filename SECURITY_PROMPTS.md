# Registro de Consultas a Inteligencia Artificial - Seguridad y REST

Proyecto: **El Tenedor** (API POS con Django REST Framework + JWT).  
Asignatura: Programación Backend — Guía API RESTful segura con DRF e IA.

## 1. Recomendaciones de Seguridad (Criterio 3.1.2)

* **Herramienta consultada:** Cursor (Composer / Claude)
* **Prompt utilizado:** "Actúa como experto en backend. ¿Qué prácticas de seguridad debo aplicar en Django REST Framework para autenticación con JWT y protección de endpoints? Incluye expiración de tokens y throttling."

* **Recomendaciones aplicadas:**

| Recomendación de la IA | Implementación en El Tenedor |
|------------------------|------------------------------|
| Usar JWT (access + refresh) en lugar de sesiones para la API | `djangorestframework-simplejwt`; rutas `POST /api/token/` y `POST /api/token/refresh/` en `config/urls.py` |
| Expiración corta del access token y refresh renovable | `SIMPLE_JWT` en `config/settings.py`: access 8 h (turno de caja), refresh 7 días |
| Proteger endpoints con autenticación por defecto | `REST_FRAMEWORK["DEFAULT_AUTHENTICATION_CLASSES"]` = JWT; `DEFAULT_PERMISSION_CLASSES` = `IsAuthenticated` |
| Permisos por rol (no solo “está logueado”) | `pos/permissions.py`: cajero vs administrador (ventas, inventario, caja) |
| Throttling para frenar fuerza bruta en login y abuso de API | `AnonRateThrottle` + `UserRateThrottle` globales; scope `login` más estricto en token obtain/refresh |
| No confiar precios ni totales del cliente | Serializers y `SyncVentasView` recalculan subtotales/total en el servidor |
| Secretos y DEBUG seguros en producción | `SECRET_KEY` obligatoria si `DEBUG=False`; HSTS/SSL cookies en prod |

## 2. Refactorización RESTful (Criterio 3.1.4)

* **Prompt utilizado:** "Revisa la estructura de mis rutas y respuestas JSON. ¿Qué cambios sugieres para alinearlas con la arquitectura RESTful? Considera verbos HTTP, códigos de estado y recursos del POS El Tenedor."

* **Mejoras implementadas:**

| Sugerencia del code review | Cambio aplicado |
|----------------------------|-----------------|
| Recursos con ViewSets y verbos claros | `ProductoViewSet`, `InventarioViewSet`, `VentaViewSet`, `CajaDiariaViewSet` (`pos/views.py`) vía `DefaultRouter` |
| Códigos HTTP coherentes | `201` al crear ventas/sync/caja; `400` validación; `401`/`403` auth/permisos; `405` si se intenta borrar una venta |
| No usar DELETE en ventas (auditoría de caja) | Solo anulación con `PATCH /api/ventas/{id}/` body `{"estado":"anulada"}`; sin `DestroyModelMixin` |
| Validar JSON de escritura en serializers | `validate_detalles`, delivery vs retiro, productos activos (`pos/serializers.py`) |
| Sync offline atómico e idempotente | `POST /api/sync-ventas/` con `transaction.atomic` y `client_uuid` único |
| Documentar contrato de la API | Tabla de endpoints en `README.md` |

### Endpoints principales (referencia)

| Método | Ruta | Notas |
|--------|------|--------|
| POST | `/api/token/` | Login JWT (throttled) |
| POST | `/api/token/refresh/` | Refresh JWT (throttled) |
| POST | `/api/registro/` | Registro cajero + JWT (throttled) |
| GET | `/api/me/` | Usuario autenticado |
| GET/POST/PUT/PATCH/DELETE | `/api/productos/` | Escritura solo admin |
| GET/POST/PATCH/DELETE | `/api/inventario/` | Escritura solo admin |
| GET/POST | `/api/ventas/` | Cajero y admin |
| PATCH | `/api/ventas/{id}/` | Anular (solo admin) |
| POST | `/api/sync-ventas/` | Lote offline |
| GET/POST | `/api/caja-diaria/` | Solo admin |

Las mismas rutas están versionadas en `/api/v1/...` (criterio 3.1.4). `/api/...` se conserva porque la PWA publicada ya llama ese prefijo.

## 3. CORS, secretos y sanitización (Criterio 3.1.2)

* **Herramienta consultada:** Cursor
* **Prompt utilizado:** "Audita esta API Django REST en tres puntos: restricción de CORS, almacenamiento de secretos en variables de entorno y sanitización de entradas. ¿Cómo evito inyección SQL, que el cliente fije precios o totales, y que alguien se registre como administrador?"

* **Recomendaciones aplicadas:**

| Recomendación de la IA | Implementación en El Tenedor |
|------------------------|------------------------------|
| Lista blanca de orígenes; no abrir CORS en producción | `CORS_ALLOWED_ORIGINS` desde el entorno. `CORS_ALLOW_ALL_ORIGINS` solo si `DEBUG` es verdadero (`config/settings.py`) |
| Secretos fuera del código y `.env.example` sin claves reales | `python-dotenv` carga `.env`. Si `DEBUG=False` y `SECRET_KEY` sigue siendo la de desarrollo, el arranque falla. `.env.example` documenta las variables |
| No usar SQL crudo | Consultas solo con el ORM de Django. No hay `raw()` ni `cursor.execute` |
| Validar y no confiar en el JSON del cliente | `validate_precio`, `validate_cantidad`, `validate_detalles` y `validate_pagos` en `pos/serializers.py`. El total se recalcula en el servidor |
| El registro público no puede escalar privilegios | `RegistroView` crea siempre `rol=cajero`. El administrador se asigna aparte |
