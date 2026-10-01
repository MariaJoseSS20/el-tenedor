"""
Django settings — El Tenedor (MVP POS gastronómico).

Arquitectura: API REST (DRF) + JWT para la PWA con modo offline.
Configuración por variables de entorno para despliegue gratis (Render + Neon).
"""

import os
import sys
from datetime import timedelta
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent

VENDOR_DIR = BASE_DIR / "vendor"
if VENDOR_DIR.exists() and str(VENDOR_DIR) not in sys.path:
    sys.path.insert(0, str(VENDOR_DIR))

try:
    from dotenv import load_dotenv

    load_dotenv(BASE_DIR / ".env")
except ImportError:
    pass


def env_bool(name, default=False):
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


_DEFAULT_INSECURE_KEY = (
    "django-insecure-o^7y-h*ck#3d52lferim#7c_4v7(^_onh1xysc=%t4(-j5tr8"
)

# Local: DEBUG=True por defecto. Producción (Render) debe setear DEBUG=False.
DEBUG = env_bool("DEBUG", True)

SECRET_KEY = os.environ.get("SECRET_KEY", _DEFAULT_INSECURE_KEY)
if not DEBUG and SECRET_KEY == _DEFAULT_INSECURE_KEY:
    raise ImproperlyConfigured(
        "Define SECRET_KEY en el entorno cuando DEBUG=False."
    )

ALLOWED_HOSTS = [
    h.strip()
    for h in os.environ.get("ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")
    if h.strip()
]
# Render asigna el hostname automáticamente
RENDER_EXTERNAL_HOSTNAME = os.environ.get("RENDER_EXTERNAL_HOSTNAME")
if RENDER_EXTERNAL_HOSTNAME:
    ALLOWED_HOSTS.append(RENDER_EXTERNAL_HOSTNAME)

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework_simplejwt",
    "corsheaders",
    "pos",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

# SQLite en local; Postgres (Neon/Render) si existe DATABASE_URL
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
if DATABASE_URL:
    try:
        import dj_database_url

        DATABASES = {
            "default": dj_database_url.config(
                default=DATABASE_URL,
                conn_max_age=600,
                ssl_require=env_bool("DB_SSL_REQUIRE", True),
            )
        }
    except ImportError as exc:
        raise ImportError(
            "Instala dj-database-url y psycopg para usar DATABASE_URL."
        ) from exc
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "es-cl"  # Español de Chile
TIME_ZONE = "America/Punta_Arenas"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
if DEBUG:
    STORAGES = {
        "default": {
            "BACKEND": "django.core.files.storage.FileSystemStorage",
        },
        "staticfiles": {
            "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage",
        },
    }
else:
    STORAGES = {
        "default": {
            "BACKEND": "django.core.files.storage.FileSystemStorage",
        },
        "staticfiles": {
            "BACKEND": "whitenoise.storage.CompressedStaticFilesStorage",
        },
    }

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

AUTH_USER_MODEL = "pos.CustomUser"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
    # Limita abuso de la API (recomendación IA / criterio 3.1.2).
    "DEFAULT_THROTTLE_CLASSES": (
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ),
    "DEFAULT_THROTTLE_RATES": {
        "anon": "30/minute",
        "user": "120/minute",
        "login": "10/minute",
        "pedidos": "10/minute",
    },
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=8),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": False,
    "AUTH_HEADER_TYPES": ("Bearer",),
}

# CORS / CSRF para la PWA publicada
_cors = os.environ.get(
    "CORS_ALLOWED_ORIGINS",
    "http://127.0.0.1:5180,http://localhost:5180,"
    "http://127.0.0.1:5173,http://localhost:5173,"
    "http://127.0.0.1:5174,http://localhost:5174",
)
CORS_ALLOWED_ORIGINS = [o.strip() for o in _cors.split(",") if o.strip()]
CORS_ALLOW_CREDENTIALS = True
# En desarrollo local se puede abrir; en producción se usa la lista.
CORS_ALLOW_ALL_ORIGINS = env_bool("CORS_ALLOW_ALL_ORIGINS", DEBUG)

CSRF_TRUSTED_ORIGINS = [
    o.strip()
    for o in os.environ.get("CSRF_TRUSTED_ORIGINS", _cors).split(",")
    if o.strip()
]
if RENDER_EXTERNAL_HOSTNAME:
    CSRF_TRUSTED_ORIGINS.append(f"https://{RENDER_EXTERNAL_HOSTNAME}")

if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_SSL_REDIRECT = env_bool("SECURE_SSL_REDIRECT", True)
    SECURE_HSTS_SECONDS = int(os.environ.get("SECURE_HSTS_SECONDS", "31536000"))
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True

EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"

# Usuarios demo en seed_menu (solo local o primer deploy explícito).
SEED_DEMO_USERS = env_bool("SEED_DEMO_USERS", DEBUG)

# Webpay / Transbank (integración por defecto; producción con WEBPAY_ENV=production).
WEBPAY_ENV = os.environ.get("WEBPAY_ENV", "integration").strip().lower()
WEBPAY_COMMERCE_CODE = os.environ.get("WEBPAY_COMMERCE_CODE", "").strip()
WEBPAY_API_KEY = os.environ.get("WEBPAY_API_KEY", "").strip()
# URL pública de la API (retorno de Webpay). Ej: https://api.onrender.com
PUBLIC_API_BASE_URL = os.environ.get(
    "PUBLIC_API_BASE_URL",
    "http://127.0.0.1:8003",
).rstrip("/")
# Página del cliente tras el pago.
FRONTEND_PEDIR_URL = os.environ.get(
    "FRONTEND_PEDIR_URL",
    "http://127.0.0.1:5180/pedir.html",
).rstrip("/")
