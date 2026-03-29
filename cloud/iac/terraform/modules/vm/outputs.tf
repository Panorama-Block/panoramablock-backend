output "vm_id" {
  value = azurerm_linux_virtual_machine.this.id
}

output "principal_id" {
  value = azurerm_linux_virtual_machine.this.identity[0].principal_id
}

output "private_ip_address" {
  value = azurerm_network_interface.this.private_ip_address
}
