#!/usr/bin/env bash
# Script de arranque en Render (free tier).
set -o errexit

python manage.py collectstatic --no-input
python manage.py migrate --no-input
python manage.py seed_menu
exec gunicorn config.wsgi:application --bind 0.0.0.0:${PORT:-8000}
