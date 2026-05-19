output "id" {
  value = azurerm_container_app.this.id
}

output "name" {
  value = azurerm_container_app.this.name
}

output "latest_revision_fqdn" {
  value = azurerm_container_app.this.latest_revision_fqdn
}

output "url" {
  value = "https://${azurerm_container_app.this.latest_revision_fqdn}"
}
