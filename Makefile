-include .env

# Read from .env or fall back to terraform output
PROJECT_ID ?= $(shell terraform -chdir=infra output -raw project_id)
REGION     ?= $(shell terraform -chdir=infra output -raw region)
SERVICE    ?= $(shell terraform -chdir=infra output -raw service_name)
REGISTRY   ?= $(shell terraform -chdir=infra output -raw registry)
IMAGE      := $(REGISTRY)/cassiopeia:latest

# --- Local development ---

.PHONY: dev dev-backend dev-frontend migrate new-migration build push deploy deploy-image logs

dev:              ## Start all services locally
	docker compose up

dev-backend:      ## Run backend with hot-reload (requires local postgres)
	cd backend && uv run uvicorn cassiopeia.main:app --reload

dev-frontend:     ## Run frontend dev server
	cd frontend && npm run dev

migrate:          ## Run database migrations
	cd backend && uv run alembic upgrade head

new-migration:    ## Create a new migration (usage: make new-migration msg="add foo")
	cd backend && uv run alembic revision --autogenerate -m "$(msg)"

# --- Deployment ---

build:            ## Build Docker image
	docker build -t $(IMAGE) .

push: build       ## Build and push image to Artifact Registry
	docker push $(IMAGE)

deploy: push migrate-prod  ## Build, push, deploy to Cloud Run, and run migrations
	gcloud run deploy $(SERVICE) \
		--project $(PROJECT_ID) \
		--region $(REGION) \
		--image $(IMAGE)

migrate-prod:     ## Run database migrations against production
	cd backend && uv run alembic upgrade head

deploy-image:     ## Deploy already-pushed image to Cloud Run (no build)
	gcloud run deploy $(SERVICE) \
		--project $(PROJECT_ID) \
		--region $(REGION) \
		--image $(IMAGE)

logs:             ## Tail Cloud Run logs
	gcloud run services logs tail $(SERVICE) \
		--project $(PROJECT_ID) \
		--region $(REGION)
