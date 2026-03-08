"""Backup blob storage backends (local filesystem or GCS)."""

import logging
from abc import ABC, abstractmethod
from pathlib import Path

from cassiopeia.config import settings

logger = logging.getLogger(__name__)


def _safe_key(user_sub: str) -> str:
    return user_sub.replace("|", "-").replace(":", "-").replace("/", "-") + ".enc"


class BackupStorage(ABC):
    @abstractmethod
    def write(self, user_sub: str, data: bytes) -> None: ...

    @abstractmethod
    def read(self, user_sub: str) -> bytes | None: ...

    @abstractmethod
    def delete(self, user_sub: str) -> None: ...


class FilesystemStorage(BackupStorage):
    def __init__(self, base_dir: Path) -> None:
        self._dir = base_dir

    def write(self, user_sub: str, data: bytes) -> None:
        self._dir.mkdir(parents=True, exist_ok=True)
        (self._dir / _safe_key(user_sub)).write_bytes(data)

    def read(self, user_sub: str) -> bytes | None:
        path = self._dir / _safe_key(user_sub)
        if not path.exists():
            return None
        return path.read_bytes()

    def delete(self, user_sub: str) -> None:
        path = self._dir / _safe_key(user_sub)
        if path.exists():
            path.unlink()


class GCSStorage(BackupStorage):
    def __init__(self, bucket_name: str) -> None:
        from google.cloud import storage

        client = storage.Client()
        self._bucket = client.bucket(bucket_name)

    def _blob(self, user_sub: str):  # type: ignore[no-untyped-def]
        return self._bucket.blob(_safe_key(user_sub))

    def write(self, user_sub: str, data: bytes) -> None:
        self._blob(user_sub).upload_from_string(
            data, content_type="application/octet-stream"
        )

    def read(self, user_sub: str) -> bytes | None:
        blob = self._blob(user_sub)
        if not blob.exists():
            return None
        return blob.download_as_bytes()

    def delete(self, user_sub: str) -> None:
        blob = self._blob(user_sub)
        if blob.exists():
            blob.delete()


_LOCAL_DIR = Path(__file__).resolve().parent.parent.parent / "backups"


def get_storage() -> BackupStorage:
    if settings.backup_gcs_bucket:
        return GCSStorage(settings.backup_gcs_bucket)
    return FilesystemStorage(_LOCAL_DIR)
