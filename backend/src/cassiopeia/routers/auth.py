from typing import Any

from authlib.integrations.starlette_client import OAuth  # type: ignore[import-untyped]
from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from cassiopeia.config import settings
from cassiopeia.db import get_db
from cassiopeia.models import User

router = APIRouter(prefix="/api/auth", tags=["auth"])

oauth = OAuth()


def oidc_configured() -> bool:
    return bool(settings.oidc_issuer and settings.oidc_client_id)


if oidc_configured():
    oauth.register(
        name="oidc",
        client_id=settings.oidc_client_id,
        client_secret=settings.oidc_client_secret,
        server_metadata_url=(
            f"{settings.oidc_issuer.rstrip('/')}/.well-known/openid-configuration"
        ),
        client_kwargs={"scope": "openid email profile"},
    )


def _session_user(user: User) -> dict[str, Any]:
    """Build the session dict from a User model instance."""
    return {
        "sub": user.sub,
        "email": user.email or "",
        "name": user.name or "",
        "picture": user.picture or "",
    }


@router.get("/login")
async def login(request: Request) -> RedirectResponse:
    if not oidc_configured():
        return RedirectResponse(url="/")
    redirect_uri = f"{settings.base_url}/api/auth/callback"
    return await oauth.oidc.authorize_redirect(request, redirect_uri)  # type: ignore[no-any-return]


@router.get("/callback")
async def callback(
    request: Request,
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    if not oidc_configured():
        return RedirectResponse(url="/dashboard")
    token: dict[str, Any] = await oauth.oidc.authorize_access_token(request)
    userinfo: dict[str, Any] = token.get("userinfo", {})

    oidc_sub = userinfo.get("sub", "")
    email = userinfo.get("email", "")
    name = userinfo.get("name", email)
    picture = userinfo.get("picture", "")

    result = await session.execute(select(User).where(User.sub == oidc_sub))
    user = result.scalar_one_or_none()

    if not user:
        user = User(sub=oidc_sub, email=email, name=name, picture=picture)
        session.add(user)
        await session.commit()
        await session.refresh(user)

    request.session["user"] = _session_user(user)
    return RedirectResponse(url="/dashboard")


@router.get("/logout")
async def logout(request: Request) -> RedirectResponse:
    request.session.clear()
    return RedirectResponse(url="/")


@router.get("/me")
async def me(request: Request) -> dict[str, Any]:
    user = request.session.get("user")
    if user:
        return {"authenticated": True, "user": user}
    return {"authenticated": False, "user": None}


@router.get("/config")
async def auth_config() -> dict[str, bool]:
    return {"oidc_enabled": oidc_configured()}
