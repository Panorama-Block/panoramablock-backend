resource "azurerm_private_dns_zone" "this" {
  count               = var.private_network_enabled ? 1 : 0
  name                = "${var.name_prefix}.postgres.database.azure.com"
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "this" {
  count                 = var.private_network_enabled ? 1 : 0
  name                  = "${var.name_prefix}-postgres-dns-link"
  private_dns_zone_name = azurerm_private_dns_zone.this[0].name
  resource_group_name   = var.resource_group_name
  virtual_network_id    = var.virtual_network_id
  tags                  = var.tags
}

resource "azurerm_postgresql_flexible_server" "this" {
  name                          = coalesce(var.server_name, substr(replace("${var.name_prefix}-pg", "-", ""), 0, 63))
  resource_group_name           = var.resource_group_name
  location                      = coalesce(var.server_location, var.location)
  administrator_login           = var.administrator_login
  administrator_password        = var.administrator_password
  version                       = var.postgres_version
  delegated_subnet_id           = var.private_network_enabled ? var.delegated_subnet_id : null
  private_dns_zone_id           = var.private_network_enabled ? azurerm_private_dns_zone.this[0].id : null
  storage_mb                    = var.storage_mb
  sku_name                      = var.sku_name
  backup_retention_days         = var.backup_retention_days
  zone                          = var.zone
  public_network_access_enabled = var.public_network_access_enabled
  tags                          = var.tags

  authentication {
    active_directory_auth_enabled = var.active_directory_auth_enabled
    password_auth_enabled         = var.password_auth_enabled
    tenant_id                     = var.auth_tenant_id
  }

  depends_on = [
    azurerm_private_dns_zone_virtual_network_link.this
  ]
}

resource "azurerm_postgresql_flexible_server_database" "databases" {
  for_each  = toset(var.database_names)
  name      = each.value
  server_id = azurerm_postgresql_flexible_server.this.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}

resource "azurerm_postgresql_flexible_server_firewall_rule" "rules" {
  for_each = var.public_network_access_enabled ? var.firewall_rules : {}

  name             = each.key
  server_id        = azurerm_postgresql_flexible_server.this.id
  start_ip_address = each.value.start_ip_address
  end_ip_address   = each.value.end_ip_address
}
