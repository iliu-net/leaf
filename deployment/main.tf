locals {
  common_tags = {
    environment   = "demo"
    managed_using = "OpenTofu"
    project       = "eu-de_leaf"
  }
  os_name  = "Standard_Debian_13_amd64_bios_latest"
  dev_path = "/dev/vdb"
  az       = "${var.region}-02"

  vpc_name    = "test-vpc"
  subnet_name = "test-sn"

  user_data = replace(templatefile("${path.module}/cloud-init.yaml", {
    user        = var.cloud_user.name
    passwd      = var.cloud_user.passwd
    ssh_keys    = var.cloud_user.ssh_keys
    region      = var.region
    device_path = local.dev_path
    dnsname     = var.dnsname
    ca_email    = var.ca_email
    testing_tls = var.testing_tls
  }), "\r", "")
}


# Networking: Virtual Private Cloud (VPC)
resource "opentelekomcloud_vpc_v1" "vpc_main" {
  name = local.vpc_name
  tags = local.common_tags
  cidr = "192.168.0.0/16"
}

# Networking: Subnet
resource "opentelekomcloud_vpc_subnet_v1" "sn_main" {
  name       = local.subnet_name
  cidr       = "192.168.1.0/24"
  gateway_ip = "192.168.1.1"
  vpc_id     = opentelekomcloud_vpc_v1.vpc_main.id
  tags       = local.common_tags
  ipv6_enable       = true
}

# Security: Security Group for SSH & HTTP & HTTPS
resource "opentelekomcloud_networking_secgroup_v2" "sg_test" {
  name        = "sg-testing-access"
  description = "Allow SSH and HTTP(S)"
}

resource "opentelekomcloud_networking_secgroup_rule_v2" "allow_ssh" {
  direction         = "ingress"
  ethertype         = "IPv4"
  protocol          = "tcp"
  port_range_min    = 22
  port_range_max    = 22
  remote_ip_prefix  = "0.0.0.0/0"
  security_group_id = opentelekomcloud_networking_secgroup_v2.sg_test.id
}

resource "opentelekomcloud_networking_secgroup_rule_v2" "allow_http" {
  direction         = "ingress"
  ethertype         = "IPv4"
  protocol          = "tcp"
  port_range_min    = 80
  port_range_max    = 80
  remote_ip_prefix  = "0.0.0.0/0"
  security_group_id = opentelekomcloud_networking_secgroup_v2.sg_test.id
}

resource "opentelekomcloud_networking_secgroup_rule_v2" "allow_https" {
  direction         = "ingress"
  ethertype         = "IPv4"
  protocol          = "tcp"
  port_range_min    = 443
  port_range_max    = 443
  remote_ip_prefix  = "0.0.0.0/0"
  security_group_id = opentelekomcloud_networking_secgroup_v2.sg_test.id
}

# Add a data source for the image to get its ID for the block_device block
data "opentelekomcloud_images_image_v2" "image" {
  name        = local.os_name
  most_recent = true
}

# Compute: The VM (Elastic Cloud Server)
resource "opentelekomcloud_ecs_instance_v1" "test_vm" {
  name = "leaf-demo-vm"
  flavor = "s2.medium.2"
  availability_zone = local.az

  security_groups   = [opentelekomcloud_networking_secgroup_v2.sg_test.id]
  vpc_id = opentelekomcloud_vpc_v1.vpc_main.id
  nics {
    network_id = opentelekomcloud_vpc_subnet_v1.sn_main.id
    #~ ipv6_enable = true
  }

  # System Disk (Bootable) — encrypted via KMS
  image_id                    = data.opentelekomcloud_images_image_v2.image.id
  system_disk_type            = "SAS"
  system_disk_size            = 20
  system_disk_kms_id          = opentelekomcloud_kms_key_v1.volume_key.id
  delete_disks_on_termination = true

  # Cloud-init configuration
  user_data = local.user_data

  tags = local.common_tags
}

# attachment data volume
resource "opentelekomcloud_compute_volume_attach_v2" "attach" {
  instance_id = opentelekomcloud_ecs_instance_v1.test_vm.id
  volume_id   = opentelekomcloud_evs_volume_v3.data_vol.id
  device      = local.dev_path
}


# Associate the EIP with the VM
resource "opentelekomcloud_networking_floatingip_associate_v2" "eip_assoc" {
  floating_ip = opentelekomcloud_vpc_eip_v1.my_eip.publicip[0].ip_address
  port_id     = opentelekomcloud_ecs_instance_v1.test_vm.nics.0.port_id
}

