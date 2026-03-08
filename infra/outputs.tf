output "project_id" {
  description = "GCP project ID"
  value       = var.project_id
}

output "region" {
  description = "GCP region"
  value       = var.region
}

output "service_name" {
  description = "Cloud Run service name"
  value       = google_cloud_run_v2_service.cassiopeia.name
}

output "cloud_run_url" {
  description = "URL of the Cloud Run service"
  value       = google_cloud_run_v2_service.cassiopeia.uri
}

output "registry" {
  description = "Artifact Registry URL"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.cassiopeia.repository_id}"
}

output "oidc_issuer" {
  description = "OIDC issuer URL (Auth0)"
  value       = "https://${var.auth0_domain}"
}

output "oidc_client_id" {
  description = "OIDC client ID"
  value       = auth0_client.cassiopeia.client_id
  sensitive   = true
}

output "turso_org" {
  description = "Turso organization for per-user sync databases"
  value       = var.turso_org
}
