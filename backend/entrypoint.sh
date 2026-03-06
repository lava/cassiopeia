#!/bin/bash
set -e
exec uv run uvicorn cassiopeia.main:app --host 0.0.0.0 --port 8080
