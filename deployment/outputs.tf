
# Output the Elastic IP
output "vm_eip" {
  value = opentelekomcloud_vpc_eip_v1.my_eip.publicip[0].ip_address
}

