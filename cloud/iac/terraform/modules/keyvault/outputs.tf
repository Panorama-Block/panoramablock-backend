output "key_vault_id" {
  value = azurerm_key_vault.this.id
}

output "key_vault_name" {
  value = azurerm_key_vault.this.name
}

output "vault_uri" {
  value = azurerm_key_vault.this.vault_uri
}
