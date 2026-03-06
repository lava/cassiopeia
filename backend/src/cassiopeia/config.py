from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = (
        "postgresql+asyncpg://cassiopeia:local@localhost:5432/cassiopeia"
    )

    # OIDC
    oidc_issuer: str = ""
    oidc_client_id: str = ""
    oidc_client_secret: str = ""

    # Session
    session_secret: str = "change-me-in-production"

    # Base URL for building callback URLs
    base_url: str = "http://localhost:8080"

    model_config = {"env_file": ".env", "extra": "ignore"}

    @property
    def clean_database_url(self) -> str:
        """Return database URL with sslmode stripped (handled via connect_args)."""
        url = self.database_url
        for pattern in ["?sslmode=require&", "?sslmode=require", "&sslmode=require"]:
            url = url.replace(pattern, "?" if pattern.endswith("&") else "")
        return url

    @property
    def needs_ssl(self) -> bool:
        return "sslmode=" in self.database_url


settings = Settings()
