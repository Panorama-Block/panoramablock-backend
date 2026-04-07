terraform {
  required_version = ">= 1.6.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.117"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "azurerm" {
  features {}
}

data "azurerm_client_config" "current" {}

resource "random_string" "suffix" {
  length  = 5
  upper   = false
  special = false
}

locals {
  name_prefix = "${var.project_name}-${var.environment}"
  common_tags = merge(
    {
      project     = var.project_name
      environment = var.environment
      managed_by  = "terraform"
      architecture = "single-vm-compose"
    },
    var.tags
  )
  key_vault_name = substr(replace("${local.name_prefix}-kv-${random_string.suffix.result}", "-", ""), 0, 24)
}

resource "azurerm_resource_group" "main" {
  name     = var.resource_group_name
  location = var.location
  tags     = local.common_tags
}

resource "azurerm_public_ip" "telegram_gateway" {
  count               = var.telegram_gateway_vm_enabled ? 1 : 0
  name                = "${local.name_prefix}-telegram-gateway-pip"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  allocation_method   = "Static"
  sku                 = var.public_ip_sku
  tags = merge(
    local.common_tags,
    {
      architecture = "two-vm-transition"
      workload     = "telegram-gateway"
    }
  )
}

module "network" {
  source = "./modules/network"

  resource_group_name         = azurerm_resource_group.main.name
  location                    = azurerm_resource_group.main.location
  name_prefix                 = local.name_prefix
  vnet_cidr                   = var.vnet_cidr
  app_subnet_cidr             = var.app_subnet_cidr
  postgres_subnet_cidr        = var.postgres_subnet_cidr
  public_ip_sku               = var.public_ip_sku
  tags                        = local.common_tags
}

module "vm" {
  source = "./modules/vm"

  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  name_prefix         = local.name_prefix
  subnet_id           = module.network.app_subnet_id
  public_ip_id        = module.network.public_ip_id
  vm_size             = var.vm_size
  admin_username      = var.vm_admin_username
  ssh_public_key      = var.vm_admin_ssh_public_key
  os_disk_size_gb     = var.vm_os_disk_size_gb
  app_user            = var.app_user
  app_directory       = var.app_directory
  tags                = local.common_tags
}

module "telegram_gateway_vm" {
  count  = var.telegram_gateway_vm_enabled ? 1 : 0
  source = "./modules/vm"

  resource_group_name          = azurerm_resource_group.main.name
  location                     = azurerm_resource_group.main.location
  name_prefix                  = local.name_prefix
  network_interface_name_override = "${local.name_prefix}-telegram-gateway-nic"
  vm_name_override             = "${local.name_prefix}-telegram-gateway-vm"
  os_disk_name_override        = "${local.name_prefix}-telegram-gateway-osdisk"
  subnet_id                    = module.network.app_subnet_id
  public_ip_id                 = azurerm_public_ip.telegram_gateway[0].id
  vm_size                      = var.telegram_gateway_vm_size
  admin_username               = var.vm_admin_username
  ssh_public_key               = var.vm_admin_ssh_public_key
  os_disk_size_gb              = var.vm_os_disk_size_gb
  app_user                     = var.app_user
  app_directory                = var.telegram_gateway_app_directory
  tags = merge(
    local.common_tags,
    {
      architecture = "two-vm-transition"
      workload     = "telegram-gateway"
    }
  )
}

module "keyvault" {
  source = "./modules/keyvault"

  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  key_vault_name           = local.key_vault_name
  tenant_id                = data.azurerm_client_config.current.tenant_id
  purge_protection_enabled = var.key_vault_purge_protection_enabled
  tags                     = local.common_tags
}

module "postgres" {
  source = "./modules/postgres"

  resource_group_name     = azurerm_resource_group.main.name
  location                = azurerm_resource_group.main.location
  name_prefix             = local.name_prefix
  administrator_login     = var.postgres_admin_username
  administrator_password  = var.postgres_admin_password
  sku_name                = var.postgres_sku_name
  postgres_version        = var.postgres_version
  storage_mb              = var.postgres_storage_mb
  backup_retention_days   = var.postgres_backup_retention_days
  delegated_subnet_id     = module.network.postgres_subnet_id
  virtual_network_id      = module.network.vnet_id
  database_names          = var.postgres_databases
  zone                    = var.postgres_zone
  tags                    = local.common_tags
}

resource "azurerm_key_vault_access_policy" "terraform_operator" {
  key_vault_id = module.keyvault.key_vault_id
  tenant_id    = data.azurerm_client_config.current.tenant_id
  object_id    = data.azurerm_client_config.current.object_id

  secret_permissions = [
    "Get",
    "List",
    "Set",
    "Delete",
    "Recover",
    "Purge",
  ]
}

resource "azurerm_key_vault_access_policy" "vm_identity" {
  key_vault_id = module.keyvault.key_vault_id
  tenant_id    = data.azurerm_client_config.current.tenant_id
  object_id    = module.vm.principal_id

  secret_permissions = [
    "Get",
    "List",
  ]
}

resource "azurerm_key_vault_access_policy" "deployment_principal" {
  count        = var.deployment_principal_object_id == null ? 0 : 1
  key_vault_id = module.keyvault.key_vault_id
  tenant_id    = data.azurerm_client_config.current.tenant_id
  object_id    = var.deployment_principal_object_id

  secret_permissions = [
    "Get",
    "List",
    "Set",
  ]
}

resource "azurerm_key_vault_secret" "initial_secrets" {
  for_each = nonsensitive(var.initial_key_vault_secrets)

  name         = each.key
  value        = each.value
  key_vault_id = module.keyvault.key_vault_id

  depends_on = [
    azurerm_key_vault_access_policy.terraform_operator
  ]
}
