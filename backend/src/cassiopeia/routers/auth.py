import uuid
from typing import Any

from authlib.integrations.starlette_client import OAuth  # type: ignore[import-untyped]
from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

from cassiopeia.config import settings
from cassiopeia.db import get_db
from cassiopeia.models import User, UserToken

router = APIRouter(prefix="/api/auth", tags=["auth"])

oauth = OAuth()

DEFAULT_USER = {
    "sub": "local",
    "email": "local@cassiopeia",
    "name": "Lokal",
    "picture": "",
    "is_anonymous": False,
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


def _session_user(user: User) -> dict[str, Any]:
    """Build the session dict from a User model instance."""
    return {
        "sub": user.sub,
        "email": user.email or "",
        "name": user.name or "",
        "picture": user.picture or "",
        "is_anonymous": user.is_anonymous,
    }


@router.post("/anonymous")
async def create_anonymous(
    request: Request,
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Create an anonymous user account and log them in."""
    sub = f"anon:{uuid.uuid4()}"
    user = User(sub=sub, is_anonymous=True)
    session.add(user)
    await session.commit()
    await session.refresh(user)

    request.session["user"] = _session_user(user)
    return {"authenticated": True, "user": request.session["user"]}


@router.get("/login")
async def login(request: Request) -> RedirectResponse:
    if not oidc_configured():
        return RedirectResponse(url="/dashboard")
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

    # Check if the current session is an anonymous user (account linking)
    current_user = request.session.get("user")
    anon_sub = None
    if current_user and current_user.get("is_anonymous"):
        anon_sub = current_user["sub"]

    # Check if an account with this OIDC sub already exists
    result = await session.execute(select(User).where(User.sub == oidc_sub))
    existing_user = result.scalar_one_or_none()

    if existing_user:
        # Already have a permanent account — just log in.
        # If we were anonymous, that anon account becomes orphaned (acceptable).
        user = existing_user
    elif anon_sub:
        # Link: upgrade the anonymous account to a permanent one
        result = await session.execute(select(User).where(User.sub == anon_sub))
        anon_user = result.scalar_one_or_none()
        if anon_user:
            # Update the anonymous user's sub to the OIDC sub
            old_sub = anon_user.sub
            anon_user.sub = oidc_sub
            anon_user.email = email
            anon_user.name = name
            anon_user.picture = picture
            anon_user.is_anonymous = False
            # Re-point any user_tokens referencing the old anon sub
            await session.execute(
                update(UserToken)
                .where(UserToken.user_sub == old_sub)
                .values(user_sub=oidc_sub)
            )
            await session.commit()
            user = anon_user
        else:
            # Anon user not found in DB (edge case) — create fresh
            user = User(
                sub=oidc_sub, email=email, name=name, picture=picture,
                is_anonymous=False,
            )
            session.add(user)
            await session.commit()
            await session.refresh(user)
    else:
        # New OIDC user, no anonymous session — create account
        user = User(
            sub=oidc_sub, email=email, name=name, picture=picture,
            is_anonymous=False,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)

    request.session["user"] = _session_user(user)
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
