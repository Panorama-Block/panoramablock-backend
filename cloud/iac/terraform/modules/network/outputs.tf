output "vnet_id" {
  value = azurerm_virtual_network.this.id
}

output "app_subnet_id" {
  value = azurerm_subnet.app.id
}

output "postgres_subnet_id" {
  value = azurerm_subnet.postgres.id
}

output "public_ip_id" {
  value = azurerm_public_ip.vm.id
}

output "public_ip_address" {
  value = azurerm_public_ip.vm.ip_address
}

output "network_security_group_id" {
  value = azurerm_network_security_group.app.id
}
