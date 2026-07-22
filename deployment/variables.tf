#
# Configurations
#
variable "region" {
  type        = string
  description = "Region in use"
}

variable "cloud_user" {
  description = "Credentials for a generic cloud user"
  type = object({
    name     = optional(string, "clouduser")
    passwd   = string
    ssh_keys = optional(list(string), [])
  })
  sensitive = true
  default   = { passwd = "x" }
}

variable "dnsname" {
  type        = string
  description = "DNS name for leaf server"
}

variable "ca_email" {
  type        = string
  description = "Lets Encrypt e-mail name"
}

variable "testing_tls" {
  description = "Test TLS cert requests"
  type        = bool
  default     = false
}

#
# KMS / Volume encryption
#
variable "kms_key_alias" {
  description = "Alias for the KMS customer-managed key used to encrypt volumes"
  type        = string
  default     = "leaf-volume-key"
}
