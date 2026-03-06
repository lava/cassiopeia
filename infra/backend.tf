terraform {
  backend "gcs" {
    bucket = "nerdwolke-terraform-state"
    prefix = "cassiopeia"
  }
}
