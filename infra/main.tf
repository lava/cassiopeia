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
    zitadel = {
      source  = "zitadel/zitadel"
      version = "~> 2.9"
    }
  }
}

provider "neon" {}

provider "zitadel" {
  domain       = var.zitadel_domain
  access_token = var.zitadel_token
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
# Database (Neon)
# =============================================================================

resource "neon_project" "cassiopeia" {
  name      = "cassiopeia"
  region_id = "aws-eu-central-1"

  branch {
    name          = "main"
    database_name = "cassiopeia"
    role_name     = "cassiopeia"
  }

  default_endpoint_settings {
    autoscaling_limit_min_cu = 0.25
    autoscaling_limit_max_cu = 0.25
    suspend_timeout_seconds  = 300
  }
}

# Store Neon connection URI in Secret Manager for Cloud Run
resource "google_secret_manager_secret" "database_url" {
  secret_id = "cassiopeia-database-url"

  replication {
    auto {}
  }

  depends_on = [google_project_service.required_apis]
}

resource "google_secret_manager_secret_version" "database_url" {
  secret = google_secret_manager_secret.database_url.id
  # Rewrite postgres:// to postgresql+asyncpg:// and append sslmode=require
  secret_data = replace(neon_project.cassiopeia.connection_uri, "postgres://", "postgresql+asyncpg://")
}

# =============================================================================
# Authentication (Zitadel)
# =============================================================================

resource "zitadel_project" "cassiopeia" {
  name = "cassiopeia"
}

resource "zitadel_application_oidc" "cassiopeia" {
  project_id = zitadel_project.cassiopeia.id
  name       = "cassiopeia"

  redirect_uris           = var.oidc_redirect_uris
  post_logout_redirect_uris = var.oidc_post_logout_redirect_uris
  response_types          = ["OIDC_RESPONSE_TYPE_CODE"]
  grant_types             = ["OIDC_GRANT_TYPE_AUTHORIZATION_CODE"]
  app_type                = "OIDC_APP_TYPE_WEB"
  auth_method_type        = "OIDC_AUTH_METHOD_TYPE_BASIC"
  version                 = "OIDC_VERSION_1_0"
  access_token_type       = "OIDC_TOKEN_TYPE_BEARER"
  dev_mode                = false
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
  secret_data = zitadel_application_oidc.cassiopeia.client_id
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
  secret_data = zitadel_application_oidc.cassiopeia.client_secret
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
resource "google_secret_manager_secret_iam_member" "cloud_run_database_url" {
  secret_id = google_secret_manager_secret.database_url.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run.email}"
}

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

# =============================================================================
# Cloud Run
# =============================================================================

resource "google_cloud_run_v2_service" "cassiopeia" {
  provider = google-beta
  name     = "cassiopeia"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  invoker_iam_disabled = true

  template {
    service_account = google_service_account.cloud_run.email

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.cassiopeia.repository_id}/cassiopeia:latest"

      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.database_url.secret_id
            version = "latest"
          }
        }
      }

      env {
        name  = "OIDC_ISSUER"
        value = "https://${var.zitadel_domain}"
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
