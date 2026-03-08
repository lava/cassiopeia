from typing import Any

from authlib.integrations.starlette_client import OAuth  # type: ignore[import-untyped]
from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse

from cassiopeia.config import settings
from cassiopeia.db import execute

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


@router.get("/login")
async def login(request: Request) -> RedirectResponse:
    if not oidc_configured():
        return RedirectResponse(url="/")
    redirect_uri = f"{settings.base_url}/api/auth/callback"
    return await oauth.oidc.authorize_redirect(request, redirect_uri)  # type: ignore[no-any-return]


@router.get("/callback")
async def callback(request: Request) -> RedirectResponse:
    if not oidc_configured():
        return RedirectResponse(url="/dashboard")
    token: dict[str, Any] = await oauth.oidc.authorize_access_token(request)
    userinfo: dict[str, Any] = token.get("userinfo", {})

    sub = userinfo.get("sub", "")
    email = userinfo.get("email", "")
    name = userinfo.get("name", email)
    picture = userinfo.get("picture", "")

    await execute(
        """INSERT INTO users (sub, email, name, picture)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(sub) DO UPDATE SET email=?, name=?, picture=?""",
        [sub, email, name, picture, email, name, picture],
    )

    request.session["user"] = {
        "sub": sub,
        "email": email,
        "name": name,
        "picture": picture,
    }
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
