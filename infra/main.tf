terraform {
  required_version = ">= 1.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 7.0"
    }
    neon = {
      source  = "kislerdm/neon"
      version = "~> 0.13"
    }
    auth0 = {
      source  = "auth0/auth0"
      version = "~> 1.40"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

provider "neon" {}

provider "auth0" {
  domain    = var.auth0_domain
  api_token = var.auth0_api_token
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

# Enable required APIs
resource "google_project_service" "required_apis" {
  for_each = toset([
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
  ])

  service            = each.value
  disable_on_destroy = false
}

# =============================================================================
# Database (Neon) — DEPRECATED, kept until Turso admin DB is verified
# =============================================================================

resource "neon_project" "cassiopeia" {
  name      = "cassiopeia"
  org_id    = var.neon_org_id
  region_id = "aws-eu-central-1"

  branch {
    name          = "main"
    database_name = "cassiopeia"
    role_name     = "cassiopeia"
  }

  default_endpoint_settings {
    autoscaling_limit_min_cu = 0.25
    autoscaling_limit_max_cu = 0.25
  }

  history_retention_seconds = 21600
}

# =============================================================================
# Authentication (Auth0)
# =============================================================================

resource "auth0_client" "cassiopeia" {
  name     = "cassiopeia"
  app_type = "regular_web"

  callbacks           = ["${var.app_origin}/api/auth/callback"]
  allowed_logout_urls = ["${var.app_origin}"]
  web_origins         = [var.app_origin]

  grant_types     = ["authorization_code"]
  oidc_conformant = true
}

resource "auth0_client_credentials" "cassiopeia" {
  client_id             = auth0_client.cassiopeia.client_id
  authentication_method = "client_secret_post"
}

# Store OIDC credentials in Secret Manager for Cloud Run
resource "google_secret_manager_secret" "oidc_client_id" {
  secret_id = "cassiopeia-oidc-client-id"
  replication {
    auto {}
  }
  depends_on = [google_project_service.required_apis]
}

resource "google_secret_manager_secret_version" "oidc_client_id" {
  secret      = google_secret_manager_secret.oidc_client_id.id
  secret_data = auth0_client.cassiopeia.client_id
}

resource "google_secret_manager_secret" "oidc_client_secret" {
  secret_id = "cassiopeia-oidc-client-secret"
  replication {
    auto {}
  }
  depends_on = [google_project_service.required_apis]
}

resource "google_secret_manager_secret_version" "oidc_client_secret" {
  secret      = google_secret_manager_secret.oidc_client_secret.id
  secret_data = auth0_client_credentials.cassiopeia.client_secret
}

# =============================================================================
# Turso
# =============================================================================

resource "google_secret_manager_secret" "turso_api_token" {
  secret_id = "cassiopeia-turso-api-token"
  replication {
    auto {}
  }
  depends_on = [google_project_service.required_apis]
}

resource "google_secret_manager_secret_version" "turso_api_token" {
  secret      = google_secret_manager_secret.turso_api_token.id
  secret_data = var.turso_api_token
}

# Create the admin database via Turso API (idempotent — 409 on re-create is ignored)
resource "terraform_data" "turso_admin_db" {
  triggers_replace = [var.turso_org, var.turso_group]

  provisioner "local-exec" {
    command = <<-EOT
      curl -sf -X POST \
        -H "Authorization: Bearer $TURSO_API_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"name\": \"cassiopeia-admin\", \"group\": \"$TURSO_GROUP\"}" \
        "https://api.turso.tech/v1/organizations/$TURSO_ORG/databases" \
        || true
    EOT

    environment = {
      TURSO_API_TOKEN = var.turso_api_token
      TURSO_ORG       = var.turso_org
      TURSO_GROUP     = var.turso_group
    }
  }
}

# Generate an auth token for the admin database
data "external" "turso_admin_db_token" {
  depends_on = [terraform_data.turso_admin_db]

  program = ["bash", "-c", <<-EOT
    read -r INPUT
    API_TOKEN=$(echo "$INPUT" | jq -r '.api_token')
    ORG=$(echo "$INPUT" | jq -r '.org')
    JWT=$(curl -sf -X POST \
      -H "Authorization: Bearer $API_TOKEN" \
      "https://api.turso.tech/v1/organizations/$ORG/databases/cassiopeia-admin/auth/tokens" \
      | jq -r '.jwt')
    jq -n --arg jwt "$JWT" '{"jwt": $jwt}'
  EOT
  ]

  query = {
    api_token = var.turso_api_token
    org       = var.turso_org
  }
}

resource "google_secret_manager_secret" "turso_admin_db_token" {
  secret_id = "cassiopeia-turso-admin-db-token"
  replication {
    auto {}
  }
  depends_on = [google_project_service.required_apis]
}

resource "google_secret_manager_secret_version" "turso_admin_db_token" {
  secret      = google_secret_manager_secret.turso_admin_db_token.id
  secret_data = data.external.turso_admin_db_token.result.jwt
}

# =============================================================================
# Session
# =============================================================================

resource "random_password" "session_secret" {
  length  = 48
  special = false
}

resource "google_secret_manager_secret" "session_secret" {
  secret_id = "cassiopeia-session-secret"
  replication {
    auto {}
  }
  depends_on = [google_project_service.required_apis]
}

resource "google_secret_manager_secret_version" "session_secret" {
  secret      = google_secret_manager_secret.session_secret.id
  secret_data = random_password.session_secret.result
}

# =============================================================================
# Artifact Registry
# =============================================================================

resource "google_artifact_registry_repository" "cassiopeia" {
  location      = var.region
  repository_id = "cassiopeia"
  format        = "DOCKER"

  cleanup_policies {
    id     = "delete-untagged"
    action = "DELETE"

    condition {
      tag_state  = "UNTAGGED"
      older_than = "259200s" # 3 days
    }
  }

  depends_on = [google_project_service.required_apis]
}

# Seed the registry with an initial image so Cloud Run can be created
resource "terraform_data" "seed_image" {
  triggers_replace = [google_artifact_registry_repository.cassiopeia.id]

  provisioner "local-exec" {
    command = <<-EOT
      docker pull us-docker.pkg.dev/cloudrun/container/hello
      docker tag us-docker.pkg.dev/cloudrun/container/hello ${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.cassiopeia.repository_id}/cassiopeia:latest
      docker push ${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.cassiopeia.repository_id}/cassiopeia:latest
    EOT
  }
}

# =============================================================================
# Service Accounts
# =============================================================================

resource "google_service_account" "cloud_run" {
  account_id   = "cassiopeia-cloud-run"
  display_name = "Cassiopeia Cloud Run Service Account"
}

# Cloud Run SA needs to read secrets
resource "google_secret_manager_secret_iam_member" "cloud_run_oidc_client_id" {
  secret_id = google_secret_manager_secret.oidc_client_id.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_secret_manager_secret_iam_member" "cloud_run_oidc_client_secret" {
  secret_id = google_secret_manager_secret.oidc_client_secret.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_secret_manager_secret_iam_member" "cloud_run_turso_api_token" {
  secret_id = google_secret_manager_secret.turso_api_token.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_secret_manager_secret_iam_member" "cloud_run_session_secret" {
  secret_id = google_secret_manager_secret.session_secret.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_secret_manager_secret_iam_member" "cloud_run_turso_admin_db_token" {
  secret_id = google_secret_manager_secret.turso_admin_db_token.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run.email}"
}

# =============================================================================
# Cloud Run
# =============================================================================

resource "google_cloud_run_v2_service" "cassiopeia" {
  provider = google-beta
  name     = "cassiopeia"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  deletion_protection  = false
  invoker_iam_disabled = true

  template {
    service_account = google_service_account.cloud_run.email

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.cassiopeia.repository_id}/cassiopeia:latest"

      env {
        name  = "TURSO_ADMIN_DB_URL"
        value = "libsql://cassiopeia-admin-${var.turso_org}.turso.io"
      }

      env {
        name = "TURSO_ADMIN_DB_TOKEN"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.turso_admin_db_token.secret_id
            version = "latest"
          }
        }
      }

      env {
        name  = "BASE_URL"
        value = var.app_origin
      }

      env {
        name  = "OIDC_ISSUER"
        value = "https://${var.auth0_domain}"
      }

      env {
        name = "OIDC_CLIENT_ID"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.oidc_client_id.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "OIDC_CLIENT_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.oidc_client_secret.secret_id
            version = "latest"
          }
        }
      }

      env {
        name  = "TURSO_ORG"
        value = var.turso_org
      }

      env {
        name = "TURSO_API_TOKEN"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.turso_api_token.secret_id
            version = "latest"
          }
        }
      }

      env {
        name  = "TURSO_GROUP"
        value = var.turso_group
      }

      env {
        name = "SESSION_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.session_secret.secret_id
            version = "latest"
          }
        }
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle = true
      }
    }

    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }
  }

  depends_on = [google_project_service.required_apis, terraform_data.seed_image]
}
