resource "azurerm_private_dns_zone" "this" {
  name                = "${var.name_prefix}.postgres.database.azure.com"
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "this" {
  name                  = "${var.name_prefix}-postgres-dns-link"
  private_dns_zone_name = azurerm_private_dns_zone.this.name
  resource_group_name   = var.resource_group_name
  virtual_network_id    = var.virtual_network_id
  tags                  = var.tags
}

resource "azurerm_postgresql_flexible_server" "this" {
  name                   = substr(replace("${var.name_prefix}-pg", "-", ""), 0, 63)
  resource_group_name    = var.resource_group_name
  location               = var.location
  administrator_login    = var.administrator_login
  administrator_password = var.administrator_password
  version                = var.postgres_version
  delegated_subnet_id    = var.delegated_subnet_id
  private_dns_zone_id    = azurerm_private_dns_zone.this.id
  storage_mb             = var.storage_mb
  sku_name               = var.sku_name
  backup_retention_days  = var.backup_retention_days
  zone                   = var.zone
  public_network_access_enabled = false
  tags                   = var.tags

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
