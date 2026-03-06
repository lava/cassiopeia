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

output "neon_project_id" {
  description = "Neon project ID"
  value       = neon_project.cassiopeia.id
}

output "neon_host" {
  description = "Neon database host"
  value       = neon_project.cassiopeia.database_host
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
