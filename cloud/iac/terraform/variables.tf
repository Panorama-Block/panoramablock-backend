variable "project_name" {
  description = "Short project name used in Azure resource names."
  type        = string
  default     = "panorama"
}

variable "environment" {
  description = "Environment name such as dev, test, or prod."
  type        = string
  default     = "dev"
}

variable "location" {
  description = "Azure region."
  type        = string
  default     = "East US"
}

variable "resource_group_name" {
  description = "Resource group name."
  type        = string
  default     = "rg-panorama-dev"
}

variable "vnet_cidr" {
  description = "VNet CIDR block."
  type        = string
  default     = "10.20.0.0/16"
}

variable "app_subnet_cidr" {
  description = "Subnet for the Linux VM."
  type        = string
  default     = "10.20.1.0/24"
}

variable "postgres_subnet_cidr" {
  description = "Delegated subnet for PostgreSQL Flexible Server."
  type        = string
  default     = "10.20.2.0/24"
}

variable "public_ip_sku" {
  description = "Public IP SKU."
  type        = string
  default     = "Standard"
}

variable "vm_size" {
  description = "VM size. Start with Standard_B1ms for cheap testing."
  type        = string
  default     = "Standard_B1ms"
}

variable "vm_admin_username" {
  description = "Admin SSH username for the VM."
  type        = string
  default     = "azureuser"
}

variable "vm_admin_ssh_public_key" {
  description = "SSH public key content for the admin user."
  type        = string
}

variable "vm_os_disk_size_gb" {
  description = "OS disk size in GiB."
  type        = number
  default     = 64
}

variable "app_user" {
  description = "Local Linux user that owns deployment files."
  type        = string
  default     = "panorama"
}

variable "app_directory" {
  description = "Directory where the deployment bundle will live on the VM."
  type        = string
  default     = "/opt/panorama"
}

variable "postgres_admin_username" {
  description = "Admin username for PostgreSQL Flexible Server."
  type        = string
  default     = "pgadmin"
}

variable "postgres_server_name" {
  description = "Optional exact PostgreSQL Flexible Server name. Use this when importing an existing server."
  type        = string
  default     = null
}

variable "postgres_location" {
  description = "Optional PostgreSQL server region. Defaults to the resource group location."
  type        = string
  default     = null
}

variable "postgres_admin_password" {
  description = "Admin password for PostgreSQL Flexible Server."
  type        = string
  sensitive   = true
}

variable "postgres_active_directory_auth_enabled" {
  description = "Enable Microsoft Entra authentication for PostgreSQL Flexible Server."
  type        = bool
  default     = false
}

variable "postgres_password_auth_enabled" {
  description = "Enable password authentication for PostgreSQL Flexible Server."
  type        = bool
  default     = true
}

variable "postgres_auth_tenant_id" {
  description = "Tenant ID used for PostgreSQL Microsoft Entra authentication. Defaults to the active Azure tenant when Entra auth is enabled."
  type        = string
  default     = null
}

variable "postgres_sku_name" {
  description = "Flexible Server SKU. Cheapest viable managed option is B_Standard_B1ms."
  type        = string
  default     = "B_Standard_B1ms"
}

variable "postgres_version" {
  description = "PostgreSQL major version."
  type        = string
  default     = "15"
}

variable "postgres_storage_mb" {
  description = "Storage in MiB."
  type        = number
  default     = 32768
}

variable "postgres_backup_retention_days" {
  description = "Backup retention in days."
  type        = number
  default     = 7
}

variable "postgres_zone" {
  description = "Availability zone. Leave null if you do not care."
  type        = string
  default     = null
}

variable "postgres_private_network_enabled" {
  description = "Create PostgreSQL with VNet delegated subnet and private DNS."
  type        = bool
  default     = true
}

variable "postgres_public_network_access_enabled" {
  description = "Enable public network access for PostgreSQL Flexible Server."
  type        = bool
  default     = false
}

variable "postgres_firewall_rules" {
  description = "Firewall rules for PostgreSQL Flexible Server when public network access is enabled."
  type = map(object({
    start_ip_address = string
    end_ip_address   = string
  }))
  default = {}
}

variable "postgres_databases" {
  description = "Application databases to create on the shared PostgreSQL server."
  type        = list(string)
  default = [
    "panorama_core",
    "panorama_dca",
    "tac_service",
    "panorama_lido",
  ]
}

variable "key_vault_purge_protection_enabled" {
  description = "Enable purge protection. Useful later, but can slow destroy/recreate cycles in dev."
  type        = bool
  default     = false
}

variable "deployment_principal_object_id" {
  description = "Optional object ID for the GitHub Actions deploy principal."
  type        = string
  default     = null
}

variable "initial_key_vault_secrets" {
  description = "Optional bootstrap secrets to write into Key Vault during apply."
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "tags" {
  description = "Extra tags."
  type        = map(string)
  default     = {}
}

variable "telegram_gateway_vm_enabled" {
  description = "Create a second VM for Telegram gateway traffic."
  type        = bool
  default     = false
}

variable "telegram_gateway_vm_size" {
  description = "VM size for the Telegram gateway VM."
  type        = string
  default     = "Standard_B1ms"
}

variable "telegram_gateway_app_directory" {
  description = "Directory where the Telegram gateway deployment bundle will live on the VM."
  type        = string
  default     = "/opt/telegram-gateway"
}
