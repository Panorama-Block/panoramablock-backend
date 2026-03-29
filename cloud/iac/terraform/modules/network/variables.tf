variable "resource_group_name" {
  type = string
}

variable "location" {
  type = string
}

variable "name_prefix" {
  type = string
}

variable "vnet_cidr" {
  type = string
}

variable "app_subnet_cidr" {
  type = string
}

variable "postgres_subnet_cidr" {
  type = string
}

variable "public_ip_sku" {
  type = string
}

variable "tags" {
  type = map(string)
}
