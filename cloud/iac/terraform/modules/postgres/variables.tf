variable "resource_group_name" {
  type = string
}

variable "location" {
  type = string
}

variable "server_location" {
  type    = string
  default = null
}

variable "name_prefix" {
  type = string
}

variable "server_name" {
  type    = string
  default = null
}

variable "administrator_login" {
  type = string
}

variable "administrator_password" {
  type      = string
  sensitive = true
}

variable "active_directory_auth_enabled" {
  type    = bool
  default = false
}

variable "password_auth_enabled" {
  type    = bool
  default = true
}

variable "auth_tenant_id" {
  type    = string
  default = null
}

variable "sku_name" {
  type = string
}

variable "postgres_version" {
  type = string
}

variable "storage_mb" {
  type = number
}

variable "backup_retention_days" {
  type = number
}

variable "delegated_subnet_id" {
  type    = string
  default = null
}

variable "virtual_network_id" {
  type    = string
  default = null
}

variable "private_network_enabled" {
  type    = bool
  default = true
}

variable "public_network_access_enabled" {
  type    = bool
  default = false
}

variable "firewall_rules" {
  type = map(object({
    start_ip_address = string
    end_ip_address   = string
  }))
  default = {}
}

variable "database_names" {
  type = list(string)
}

variable "zone" {
  type    = string
  default = null
}

variable "tags" {
  type = map(string)
}
