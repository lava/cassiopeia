# Stage 1: Build frontend
FROM oven/bun:1 AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/bun.lock ./
RUN bun install --frozen-lockfile
COPY frontend/ ./
RUN bun run build

# Stage 2: Python app
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --extra gcs
COPY backend/src/ ./src/
COPY backend/entrypoint.sh ./
RUN chmod +x entrypoint.sh
COPY --from=frontend-build /app/frontend/build ./static/
CMD ["./entrypoint.sh"]
