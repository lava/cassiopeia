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

variable "auth0_domain" {
  description = "Auth0 tenant domain (e.g. my-tenant.eu.auth0.com)"
  type        = string
}

variable "auth0_api_token" {
  description = "Auth0 Management API token"
  type        = string
  sensitive   = true
}

variable "app_origin" {
  description = "Public origin of the app, no trailing slash (e.g. https://app.example.com)"
  type        = string
  default     = "http://localhost:8080"
}

variable "turso_org" {
  description = "Turso organization slug (used for per-user DB provisioning)"
  type        = string
}

variable "turso_api_token" {
  description = "Turso platform API token"
  type        = string
  sensitive   = true
}

variable "turso_group" {
  description = "Turso database group for new user databases"
  type        = string
  default     = "default"
}

variable "session_secret" {
  description = "Secret key for signing session cookies"
  type        = string
  sensitive   = true
}
