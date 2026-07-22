#
# Configure resources that are persistent
#
#
# Encryption Key (KMS)
# - Custom encryption key for volume encryption at rest
#
resource "opentelekomcloud_kms_key_v1" "volume_key" {
  key_alias       = var.kms_key_alias
  key_description = "Customer-managed key for encrypting leaf application volumes"
  tags            = local.common_tags
  realm           = var.region
  is_enabled      = true
  lifecycle {
    prevent_destroy = true
  }
}


#
# persistent data volume
# - mainly to persist TLS certificates and app data
# - encrypted at rest using the KMS key above
#
resource "opentelekomcloud_evs_volume_v3" "data_vol" {
  name        = "evs-leaf"
  size        = 16 # GB
  volume_type = "SAS"
  kms_id      = opentelekomcloud_kms_key_v1.volume_key.id
  availability_zone = local.az

  lifecycle {
    prevent_destroy = true
  }
  tags = local.common_tags
}

# Create the Elastic IP
resource "opentelekomcloud_vpc_eip_v1" "my_eip" {
  publicip {
    type = "5_bgp" # Standard BGP type for Open Telekom Cloud
  }
  bandwidth {
    name        = "testing-bandwidth"
    size        = 5 # Bandwidth in Mbps
    share_type  = "PER"
    charge_mode = "traffic"
  }
  lifecycle {
    prevent_destroy = true
  }
}

