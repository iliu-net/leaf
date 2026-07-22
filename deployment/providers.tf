
# Provider configuration
# Use environment variables (OS_USERNAME, OS_PASSWORD, etc.) for authentication

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    opentelekomcloud = {
      source  = "opentelekomcloud/opentelekomcloud"
      version = ">= 1.35.0"
    }
    local = {
      source  = "hashicorp/local"
      version = ">= 2.4.0"
    }
  }
  # Use a remote state
  backend "s3" {}
}
provider "local" {}

# Provider configuration
# Use environment variables (OS_USERNAME, OS_PASSWORD, etc.) for authentication
provider "opentelekomcloud" {
  # tenant_name = "eu-de"
  # region = "eu-de"
  # auth_url    = "https://iam.eu-nl.otc.t-systems.com/v3"
}



