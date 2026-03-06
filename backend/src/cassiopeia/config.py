from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = (
        "postgresql+asyncpg://cassiopeia:local@localhost:5432/cassiopeia"
    )

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
