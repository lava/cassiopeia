# Cassiopeia

Health tracking app that consolidates data from Oura, Garmin, and Bearable into a single dashboard with trend visualization and daily condition scoring.

## Self-hosted (Docker Compose)

### Prerequisites

- Docker & Docker Compose
- An OIDC provider (optional — without it, only anonymous accounts are available)

### Quick start

```bash
docker compose up
```

This starts PostgreSQL, runs migrations, and launches the app at `http://localhost:8080`.
Without OIDC credentials, the app offers anonymous login only.

To enable OIDC login, set credentials (via a `.env` file or env vars):

```bash
export OIDC_ISSUER=https://my-tenant.eu.auth0.com
export OIDC_CLIENT_ID=your-client-id
export OIDC_CLIENT_SECRET=your-client-secret
```

### Environment variables

| Variable | Description | Example |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string (set automatically in compose) | `postgresql+asyncpg://cassiopeia:local@db:5432/cassiopeia` |
| `BASE_URL` | Public URL of the app | `http://localhost:8080` |
| `OIDC_ISSUER` | OIDC provider issuer URL | `https://my-tenant.eu.auth0.com` |
| `OIDC_CLIENT_ID` | OIDC client ID | |
| `OIDC_CLIENT_SECRET` | OIDC client secret | |

For production, change the database password and set `BASE_URL` to your public domain.

## Cloud deployment (GCP)

The `infra/` directory contains Terraform to deploy on Google Cloud Platform:

- **Cloud Run** (scales to zero)
- **Neon** (managed PostgreSQL)
- **Auth0** (authentication)
- **Artifact Registry** (Docker images)
- **GitHub Actions** with Workload Identity Federation (CI/CD)

### Prerequisites

- [Terraform](https://developer.hashicorp.com/terraform/install) >= 1.0
- [gcloud CLI](https://cloud.google.com/sdk/docs/install), authenticated
- GCP project with billing enabled
- Neon account (`NEON_API_KEY` env var)
- Auth0 tenant with a Management API token

### Setup

1. **Configure Terraform backend:**

   ```bash
   cp infra/backend.conf.example infra/backend.conf
   # Set your GCS bucket for state storage
   ```

2. **Configure variables:**

   ```bash
   cp infra/terraform.tfvars.example infra/terraform.tfvars
   # Fill in project_id, neon_org_id, auth0_domain, app_origin
   ```

3. **Deploy infrastructure:**

   ```bash
   cd infra
   terraform init -backend-config=backend.conf
   terraform apply
   ```

4. **Build and deploy the app:**

   ```bash
   make deploy
   ```

### Ongoing deployments

```bash
make deploy        # Build, push, migrate, and deploy
make deploy-image  # Deploy an already-pushed image
make migrate-prod  # Run migrations against production
make logs          # Tail Cloud Run logs
```

## Local development

```bash
# Start PostgreSQL + run migrations
docker compose up db migrate

# Backend with hot-reload
make dev-backend

# Frontend dev server
make dev-frontend
```

### Creating migrations

```bash
make new-migration msg="add foo table"
```
