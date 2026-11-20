from typing import Any
from ..models.auth import User

DEFAULT_PERMISSIONS: dict[str, bool] = {
    "cameras.view": False,
    "cameras.manage": False,
    "zones.manage": False,
    "recordings.view": False,
    "events.view": False,
    "alerts.view": False,
    "alerts.manage": False,
    "sharing.manage": False,
    "storage.view": False,
    "storage.manage": False,
    "integrations.manage": False,
    "system.view": False,
    "users.manage": False,
}

ROLE_DEFAULTS: dict[str, dict[str, bool]] = {
    "admin": {key: True for key in DEFAULT_PERMISSIONS},
    "operator": {
        "cameras.view": True,
        "cameras.manage": True,
        "zones.manage": True,
        "recordings.view": True,
        "events.view": True,
        "alerts.view": True,
        "alerts.manage": True,
        "sharing.manage": True,
        "storage.view": True,
        "system.view": True,
    },
    "viewer": {
        "cameras.view": True,
        "recordings.view": True,
        "events.view": True,
        "alerts.view": True,
    },
}


def normalize_permissions(value: Any, role: str | None = None) -> dict[str, bool]:
    result = dict(DEFAULT_PERMISSIONS)
    result.update(ROLE_DEFAULTS.get(role or "", ROLE_DEFAULTS["viewer"]))
    if isinstance(value, dict):
        for key, enabled in value.items():
            if key in DEFAULT_PERMISSIONS:
                result[key] = bool(enabled)
    return result


def permissions_for(user: User) -> dict[str, bool]:
    permissions = getattr(user, "permissions", None)
    role = getattr(user, "role", None)
    if role == "admin":
        return {key: True for key in DEFAULT_PERMISSIONS}
    return normalize_permissions(permissions, role)


def has_permission(user: User, permission: str) -> bool:
    if getattr(user, "role", None) == "admin":
        return True
    return permissions_for(user).get(permission, False)
