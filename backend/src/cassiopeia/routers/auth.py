from typing import Any

from authlib.integrations.starlette_client import OAuth  # type: ignore[import-untyped]
from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

from cassiopeia.config import settings

router = APIRouter(prefix="/api/auth", tags=["auth"])

oauth = OAuth()

DEFAULT_USER = {
    "sub": "local",
    "email": "local@cassiopeia",
    "name": "Lokal",
    "picture": "",
}


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


class AutoLoginMiddleware(BaseHTTPMiddleware):
    """When OIDC is not configured, auto-populate the session with a default user.

    This means the rest of the codebase never needs to distinguish between
    auth-enabled and auth-disabled modes — there is always a user.
    """

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        if not oidc_configured() and "user" not in request.session:
            request.session["user"] = DEFAULT_USER
        return await call_next(request)


@router.get("/login")
async def login(request: Request) -> RedirectResponse:
    if not oidc_configured():
        return RedirectResponse(url="/dashboard")
    redirect_uri = f"{settings.base_url}/api/auth/callback"
    return await oauth.oidc.authorize_redirect(request, redirect_uri)  # type: ignore[no-any-return]


@router.get("/callback")
async def callback(request: Request) -> RedirectResponse:
    if not oidc_configured():
        return RedirectResponse(url="/dashboard")
    token: dict[str, Any] = await oauth.oidc.authorize_access_token(request)
    userinfo: dict[str, Any] = token.get("userinfo", {})

    request.session["user"] = {
        "sub": userinfo.get("sub", ""),
        "email": userinfo.get("email", ""),
        "name": userinfo.get("name", userinfo.get("email", "")),
        "picture": userinfo.get("picture", ""),
    }

    return RedirectResponse(url="/dashboard")


@router.get("/logout")
async def logout(request: Request) -> RedirectResponse:
    request.session.clear()
    if not oidc_configured():
        # In no-auth mode the middleware will re-populate on next request,
        # so logout just redirects home.
        return RedirectResponse(url="/")
    return RedirectResponse(url="/")


@router.get("/me")
async def me(request: Request) -> dict[str, Any]:
    user = request.session.get("user")
    if user:
        return {"authenticated": True, "user": user}
    return {"authenticated": False, "user": None}
