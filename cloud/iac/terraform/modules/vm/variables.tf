variable "resource_group_name" {
  type = string
}

variable "location" {
  type = string
}

variable "name_prefix" {
  type = string
}

variable "subnet_id" {
  type = string
}

variable "public_ip_id" {
  type = string
}

variable "vm_size" {
  type = string
}

variable "admin_username" {
  type = string
}

variable "ssh_public_key" {
  type = string
}

variable "os_disk_size_gb" {
  type = number
}

variable "app_user" {
  type = string
}

variable "app_directory" {
  type = string
}

variable "tags" {
  type = map(string)
}
