variable "resource_group_name" {
  type = string
}

variable "location" {
  type = string
}

variable "name_prefix" {
  type = string
}

variable "administrator_login" {
  type = string
}

variable "administrator_password" {
  type      = string
  sensitive = true
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
  type = string
}

variable "virtual_network_id" {
  type = string
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
