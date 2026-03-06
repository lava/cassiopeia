variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for resources"
  type        = string
  default     = "europe-west4"
}

variable "neon_org_id" {
  description = "Neon organization ID"
  type        = string
}

variable "zitadel_org_id" {
  description = "Zitadel organization ID"
  type        = string
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

variable "app_origin" {
  description = "Public origin of the app, no trailing slash (e.g. https://app.example.com)"
  type        = string
  default     = "http://localhost:8080"
}
