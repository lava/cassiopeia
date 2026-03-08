from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # OIDC
    oidc_issuer: str = ""
    oidc_client_id: str = ""
    oidc_client_secret: str = ""

    # Session
    session_secret: str = "change-me-in-production"

    # Base URL for building callback URLs
    base_url: str = "http://localhost:8080"

    # Turso
    turso_org: str = ""
    turso_api_token: str = ""
    turso_group: str = "default"

    # Admin database (Turso)
    turso_admin_db_url: str = ""
    turso_admin_db_token: str = ""

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
