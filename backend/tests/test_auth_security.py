from app.auth.security import hash_password, verify_password
from app.config import Settings


def test_password_hashing():
    encoded = hash_password("secret")
    assert encoded != "secret"
    assert verify_password("secret", encoded)
    assert not verify_password("wrong", encoded)


def test_cookie_security_defaults_to_environment_and_allows_explicit_override():
    assert Settings(environment="development").secure_cookies is False
    assert Settings(environment="production").secure_cookies is True
    assert Settings(environment="production", cookie_secure=False).secure_cookies is False
