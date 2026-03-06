variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for resources"
  type        = string
  default     = "europe-west4"
}

variable "zitadel_domain" {
  description = "Zitadel instance domain (e.g. my-instance-abc123.zitadel.cloud)"
  type        = string
}

variable "zitadel_token" {
  description = "Zitadel Personal Access Token"
  type        = string
  sensitive   = true
}

variable "oidc_redirect_uris" {
  description = "OIDC redirect URIs for the application"
  type        = list(string)
  default     = ["http://localhost:8080/auth/callback"]
}

variable "oidc_post_logout_redirect_uris" {
  description = "OIDC post-logout redirect URIs"
  type        = list(string)
  default     = ["http://localhost:8080"]
}
