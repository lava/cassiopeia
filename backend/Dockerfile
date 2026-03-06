# Stage 1: Build frontend
FROM node:22-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Python app
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev
COPY backend/src/ ./src/
COPY backend/alembic/ ./alembic/
COPY backend/alembic.ini ./
COPY backend/entrypoint.sh ./
RUN chmod +x entrypoint.sh
COPY --from=frontend-build /app/frontend/build ./static/
CMD ["./entrypoint.sh"]
