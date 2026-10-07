"""Comprobación de clave más liviana para el servidor chico de Azure.

Django 6 usa 1 500 000 iteraciones. En ese equipo cada ingreso tardaba
varios segundos. 100 000 deja el ingreso en menos de un segundo.
"""

from django.contrib.auth.hashers import PBKDF2PasswordHasher


class Pbkdf2PosHasher(PBKDF2PasswordHasher):
    iterations = 100_000
