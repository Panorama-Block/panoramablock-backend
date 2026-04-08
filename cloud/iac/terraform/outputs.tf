output "resource_group_name" {
  value = azurerm_resource_group.main.name
}

output "vm_public_ip_address" {
  value = module.network.public_ip_address
}

output "vm_private_ip_address" {
  value = module.vm.private_ip_address
}

output "vm_principal_id" {
  value = module.vm.principal_id
}

output "key_vault_name" {
  value = module.keyvault.key_vault_name
}

output "key_vault_uri" {
  value = module.keyvault.vault_uri
}

output "postgres_fqdn" {
  value = module.postgres.fqdn
}

output "postgres_private_dns_zone" {
  value = module.postgres.private_dns_zone_name
}

output "telegram_gateway_public_ip_address" {
  value = try(azurerm_public_ip.telegram_gateway[0].ip_address, null)
}

output "telegram_gateway_private_ip_address" {
  value = try(module.telegram_gateway_vm[0].private_ip_address, null)
}

output "public_api_vm_public_ip_address" {
  value = try(azurerm_public_ip.telegram_gateway[0].ip_address, null)
}

output "public_api_vm_private_ip_address" {
  value = try(module.telegram_gateway_vm[0].private_ip_address, null)
}
