# Despliegue GRATIS — El Tenedor (en línea)

Cualquier persona con usuario y contraseña podrá entrar desde internet.
Stack gratis recomendado:

| Pieza | Servicio gratis | Qué hace |
|-------|-----------------|----------|
| Base de datos | [Neon](https://neon.tech) | PostgreSQL |
| API Django | [Render](https://render.com) | Backend |
| PWA | [Netlify](https://www.netlify.com) | Frontend |
| Código | [GitHub](https://github.com) | Repositorio |

> Nota: el plan free de Render **se duerme** tras ~15 min sin uso. La primera visita puede tardar 30–60 s en “despertar”.

---

## Paso 0 — Subir el código a GitHub

1. Crea una cuenta en GitHub (si no tienes).
2. Crea un repositorio vacío (ej. `el-tenedor`).
3. En la terminal:

```bash
cd /Users/mariajose/el-tenedor
git init
git add .
git commit -m "MVP El Tenedor listo para despliegue gratis"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/el-tenedor.git
git push -u origin main
```

---

## Paso 1 — Base de datos gratis (Neon)

1. Entra a https://neon.tech y crea un proyecto.
2. Copia la **connection string** (`DATABASE_URL`), algo como:
   `postgresql://user:pass@ep-xxx.aws.neon.tech/neondb?sslmode=require`

---

## Paso 2 — API en Render (gratis)

1. Entra a https://render.com → **New** → **Web Service**.
2. Conecta el repo de GitHub `el-tenedor`.
3. Configura:
   - **Runtime:** Python
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `bash build.sh`
   - **Instance type:** Free
4. Variables de entorno:

| Key | Value |
|-----|--------|
| `DEBUG` | `False` |
| `SECRET_KEY` | (Generate / una clave larga aleatoria) |
| `DATABASE_URL` | (pega la de Neon) |
| `ALLOWED_HOSTS` | `.onrender.com` |
| `DB_SSL_REQUIRE` | `True` |
| `CORS_ALLOW_ALL_ORIGINS` | `False` |
| `CORS_ALLOWED_ORIGINS` | `https://TU-SITIO.netlify.app` *(lo completas en el paso 3)* |
| `CSRF_TRUSTED_ORIGINS` | `https://TU-SITIO.netlify.app` |

5. Deploy. Anota la URL de la API, ej.:
   `https://el-tenedor-api.onrender.com`

Prueba: `https://TU-API.onrender.com/api/token/`

Usuarios demo (el `build.sh` ejecuta `seed_menu`):
- En producción **no** se crean solos (más seguro).
- Opción A (recomendada): crea un superusuario (paso “Crear más usuarios” abajo).
- Opción B (arranque rápido): agrega `SEED_DEMO_USERS=True` en Render solo en el primer deploy, anota `admin` / `admin123` y `cajero1` / `cajero123`, **cámbiales la clave**, y quita esa variable.

**Cambia esas claves después** desde el admin o creando usuarios nuevos.

---

## Paso 3 — PWA en Netlify (gratis)

1. Entra a https://www.netlify.com → **Add new site** → **Import from Git**.
2. Elige el mismo repo.
3. Configura:
   - **Base directory:** `frontend`
   - **Build command:** `npm install && npm run build`
   - **Publish directory:** `frontend/dist`
4. Variable de entorno:
   - `VITE_API_URL` = `https://TU-API.onrender.com`  *(sin barra al final)*
5. Deploy. Anota la URL, ej.: `https://el-tenedor.netlify.app`
6. Vuelve a Render y actualiza:
   - `CORS_ALLOWED_ORIGINS=https://el-tenedor.netlify.app`
   - `CSRF_TRUSTED_ORIGINS=https://el-tenedor.netlify.app`
7. Redeploy de la API en Render.

---

## Paso 4 — Entrar

1. Abre la URL de Netlify.
2. Login con el usuario que creaste (o los demo si activaste `SEED_DEMO_USERS`).
3. Listo: funciona en línea para quien tenga credenciales.

---

## Crear más usuarios

Con la API arriba:

1. Entra a `https://TU-API.onrender.com/admin/` con un superusuario, **o**
2. Desde tu Mac (con `DATABASE_URL` apuntando a Neon):

```bash
cd /Users/mariajose/el-tenedor
export DATABASE_URL='pega-aqui-neon'
python3 manage.py createsuperuser
# Luego en el admin asigna rol administrador o cajero
```

---

## Costos

Todo lo anterior tiene **capa gratuita**. Límites típicos:
- Render free: se duerme sin tráfico
- Neon free: cuota de almacenamiento/códigos
- Netlify free: suficiente para un MVP universitario
