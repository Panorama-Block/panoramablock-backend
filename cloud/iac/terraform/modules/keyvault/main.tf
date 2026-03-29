resource "azurerm_key_vault" "this" {
  name                          = var.key_vault_name
  location                      = var.location
  resource_group_name           = var.resource_group_name
  tenant_id                     = var.tenant_id
  sku_name                      = "standard"
  enabled_for_disk_encryption   = true
  soft_delete_retention_days    = 7
  purge_protection_enabled      = var.purge_protection_enabled
  public_network_access_enabled = true
  tags                          = var.tags
}
