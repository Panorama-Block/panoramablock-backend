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

output "container_apps_environment_id" {
  value = try(azurerm_container_app_environment.public_api[0].id, null)
}

output "container_apps_log_analytics_workspace_id" {
  value = try(azurerm_log_analytics_workspace.container_apps[0].id, null)
}

output "public_api_managed_redis_name" {
  value = try(azapi_resource.public_api_managed_redis[0].name, null)
}

output "public_api_managed_redis_hostname" {
  value = var.public_api_managed_redis_enabled ? local.public_api_redis_hostname : null
}

output "public_api_managed_redis_port" {
  value = var.public_api_managed_redis_enabled ? local.public_api_redis_port : null
}

output "public_api_managed_redis_database_id" {
  value = try(azapi_resource.public_api_managed_redis_database[0].id, null)
}

output "public_api_managed_redis_password_secret_name" {
  value = var.public_api_managed_redis_enabled ? local.public_api_redis_password_secret_name : null
}

output "public_api_container_app_urls" {
  value = var.public_api_container_apps_enabled ? {
    auth        = module.public_api_auth[0].url
    liquid_swap = module.public_api_liquid_swap[0].url
    bridge      = module.public_api_bridge[0].url
    lido        = module.public_api_lido[0].url
    lending     = module.public_api_lending[0].url
  } : {}
}
