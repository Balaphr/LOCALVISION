from collections.abc import Callable
from fastapi import Depends, HTTPException, status
from ..models.auth import User
from ..api.auth import current_user
from .permissions import has_permission


ROLE_ORDER = {"viewer": 1, "operator": 2, "admin": 3}


def require_roles(*roles: str) -> Callable:
    async def dependency(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return user
    return dependency


def require_minimum_role(role: str) -> Callable:
    async def dependency(user: User = Depends(current_user)) -> User:
        if ROLE_ORDER.get(user.role, 0) < ROLE_ORDER[role]:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return user
    return dependency


def require_permission(permission: str) -> Callable:
    async def dependency(user: User = Depends(current_user)) -> User:
        if not has_permission(user, permission):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return user
    return dependency
