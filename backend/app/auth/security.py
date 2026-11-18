import base64
import hashlib
import hmac
import secrets
from cryptography.fernet import Fernet
from ..config import get_settings


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"scrypt${base64.urlsafe_b64encode(salt).decode()}${base64.urlsafe_b64encode(digest).decode()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, salt, expected = encoded.split("$", 2)
        if algorithm != "scrypt":
            return False
        actual = hashlib.scrypt(password.encode(), salt=base64.urlsafe_b64decode(salt), n=2**14, r=8, p=1)
        return hmac.compare_digest(base64.urlsafe_b64encode(actual).decode(), expected)
    except (ValueError, TypeError):
        return False


def _fernet() -> Fernet:
    settings = get_settings()
    source = settings.encryption_key or settings.secret_key
    if not source:
        raise RuntimeError("SECRET_KEY or ENCRYPTION_KEY must be configured")
    key = base64.urlsafe_b64encode(hashlib.sha256(source.encode()).digest())
    return Fernet(key)


def encrypt_secret(value: str | None) -> str | None:
    return _fernet().encrypt(value.encode()).decode() if value else None


def decrypt_secret(value: str | None) -> str | None:
    return _fernet().decrypt(value.encode()).decode() if value else None
