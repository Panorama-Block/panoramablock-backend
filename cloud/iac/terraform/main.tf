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
    azapi = {
      source  = "Azure/azapi"
      version = "~> 2.2"
    }
  }
}

provider "azurerm" {
  features {}
}

provider "azapi" {}

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
      project      = var.project_name
      environment  = var.environment
      managed_by   = "terraform"
      architecture = var.public_api_container_apps_enabled ? "vm-and-container-apps-migration" : "single-vm-compose"
    },
    var.tags
  )
  key_vault_name = substr(replace("${local.name_prefix}-kv-${random_string.suffix.result}", "-", ""), 0, 24)

  public_api_managed_redis_name = coalesce(var.public_api_managed_redis_name, "${local.name_prefix}-public-api-redis")

  public_api_redis_hostname = var.public_api_managed_redis_enabled ? azapi_resource.public_api_managed_redis[0].output.properties.hostName : var.public_api_redis_host
  public_api_redis_port     = var.public_api_managed_redis_enabled ? tostring(var.public_api_managed_redis_port) : var.public_api_redis_port
  public_api_redis_url      = "${var.public_api_managed_redis_enabled ? "rediss" : "redis"}://${local.public_api_redis_hostname}:${local.public_api_redis_port}"

  public_api_redis_password_secret_name            = var.public_api_managed_redis_enabled ? var.public_api_managed_redis_password_secret_name : "redis-pass"
  public_api_redis_key_vault_secret_name           = lookup(var.public_api_key_vault_secret_name_overrides, local.public_api_redis_password_secret_name, local.public_api_redis_password_secret_name)
  public_api_redis_key_vault_secret_versionless_id = "${trimsuffix(module.keyvault.vault_uri, "/")}/secrets/${local.public_api_redis_key_vault_secret_name}"

  public_api_base_required_secret_names = [
    "ghcr-password",
    "auth-private-key",
    "app-domain",
    "thirdweb-client-id",
    "thirdweb-secret-key",
    "private-key",
    "admin-wallet-address",
    "ethereum-rpc-url",
    "jwt-secret",
    "database-url",
    "layerswap-api-key",
    "layerswap-ton-vault",
    "ton-jwt-secret",
    "avalanche-rpc-url",
    "rpc-url",
  ]

  public_api_required_data_secret_names = var.public_api_managed_redis_enabled ? local.public_api_base_required_secret_names : concat(
    ["redis-pass"],
    local.public_api_base_required_secret_names
  )

  public_api_secret_refs = var.public_api_container_apps_enabled ? {
    for secret_name in local.public_api_required_data_secret_names : secret_name => {
      key_vault_secret_id = data.azurerm_key_vault_secret.public_api[secret_name].id
    }
  } : {}

  public_api_secret_refs_with_managed_redis = var.public_api_container_apps_enabled && var.public_api_managed_redis_enabled ? merge(
    local.public_api_secret_refs,
    {
      (local.public_api_redis_password_secret_name) = {
        key_vault_secret_id = local.public_api_redis_key_vault_secret_versionless_id
      }
    }
  ) : local.public_api_secret_refs

  public_api_services = {
    auth = {
      name       = "${local.name_prefix}-auth-api"
      image_name = "auth-service"
      port       = 3001
      max        = 10
      plain_env = {
        PORT       = "3001"
        NODE_ENV   = "production"
        REDIS_HOST = local.public_api_redis_hostname
        REDIS_PORT = local.public_api_redis_port
        REDIS_TLS  = tostring(var.public_api_managed_redis_enabled)
      }
      secret_env = {
        REDIS_PASS         = local.public_api_redis_password_secret_name
        AUTH_PRIVATE_KEY   = "auth-private-key"
        AUTH_DOMAIN        = "app-domain"
        THIRDWEB_CLIENT_ID = "thirdweb-client-id"
      }
    }

    liquid_swap = {
      name       = "${local.name_prefix}-liquid-swap-api"
      image_name = "liquid-swap"
      port       = 3002
      max        = 5
      plain_env = {
        PORT                = "3002"
        NODE_ENV            = "production"
        DEBUG               = "false"
        ENGINE_ENABLED      = tostring(var.public_api_engine_enabled)
        ENGINE_URL          = var.public_api_engine_url
        EXECUTION_LAYER_URL = var.public_api_execution_layer_url
        TOKEN_REGISTRY_PATH = "/app/shared/token-registry.json"
        REDIS_URL           = local.public_api_redis_url
      }
      secret_env = {
        THIRDWEB_CLIENT_ID   = "thirdweb-client-id"
        THIRDWEB_SECRET_KEY  = "thirdweb-secret-key"
        PRIVATE_KEY          = "private-key"
        ADMIN_WALLET_ADDRESS = "admin-wallet-address"
        AUTH_PRIVATE_KEY     = "auth-private-key"
        REDIS_PASSWORD       = local.public_api_redis_password_secret_name
      }
    }

    bridge = {
      name       = "${local.name_prefix}-bridge-api"
      image_name = "bridge-service"
      port       = 3005
      max        = 5
      plain_env = {
        PORT                    = "3005"
        NODE_ENV                = "production"
        WEBSOCKET_PORT          = "3006"
        ENABLE_WEBSOCKET        = "true"
        ENABLE_ANALYTICS        = "true"
        LOG_LEVEL               = "info"
        CORS_ORIGIN             = "*"
        RATE_LIMIT_WINDOW       = "60000"
        RATE_LIMIT_MAX_REQUESTS = "100"
        AVAX_SERVICE_URL        = var.bridge_avax_service_url
        DB_GATEWAY_URL          = var.public_api_db_gateway_url
        THIRDWEB_ENGINE_URL     = var.public_api_engine_url
        TOKEN_REGISTRY_PATH     = "/app/shared/token-registry.json"
        TON_JWT_ISSUER          = "panoramablock-ton"
        TON_JWT_AUDIENCE        = "panoramablock"
      }
      secret_env = {
        DATABASE_URL        = "database-url"
        JWT_SECRET          = "jwt-secret"
        LAYERSWAP_API_KEY   = "layerswap-api-key"
        LAYERSWAP_TON_VAULT = "layerswap-ton-vault"
        TON_JWT_SECRET      = "ton-jwt-secret"
      }
    }

    lido = {
      name       = "${local.name_prefix}-lido-api"
      image_name = "lido-service"
      port       = 3004
      max        = 5
      plain_env = {
        PORT                  = "3004"
        NODE_ENV              = "production"
        LOG_LEVEL             = "info"
        ETHEREUM_CHAIN_ID     = "1"
        LIDO_STETH_CONTRACT   = "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84"
        LIDO_WSTETH_CONTRACT  = "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0"
        LIDO_REWARDS_CONTRACT = "0x00000000219ab540356cBB839Cbe05303d7705Fa"
        JWT_ISSUER            = "lido-service"
        JWT_AUDIENCE          = "panorama-block"
        JWT_ACCESS_EXPIRY     = "15m"
        JWT_REFRESH_EXPIRY    = "7d"
      }
      secret_env = {
        ETHEREUM_RPC_URL    = "ethereum-rpc-url"
        THIRDWEB_CLIENT_ID  = "thirdweb-client-id"
        THIRDWEB_SECRET_KEY = "thirdweb-secret-key"
        JWT_SECRET          = "jwt-secret"
      }
    }

    lending = {
      name       = "${local.name_prefix}-lending-api"
      image_name = "lending-service"
      port       = 3001
      max        = 5
      plain_env = {
        PORT                    = "3001"
        NODE_ENV                = "production"
        RATE_LIMIT_WINDOW_MS    = "60000"
        RATE_LIMIT_MAX_REQUESTS = "100"
        AUTH_SERVICE_URL        = var.public_api_auth_service_url
        EXECUTION_LAYER_URL     = var.public_api_execution_layer_url
        ENGINE_URL              = var.public_api_engine_url
        DB_GATEWAY_URL          = var.public_api_db_gateway_url
      }
      secret_env = {
        RPC_URL_AVALANCHE = "avalanche-rpc-url"
        RPC_URL           = "rpc-url"
        PRIVATE_KEY       = "private-key"
        JWT_SECRET        = "jwt-secret"
      }
    }
  }
}

data "azurerm_key_vault_secret" "public_api" {
  for_each = toset(var.public_api_container_apps_enabled ? local.public_api_required_data_secret_names : [])

  name         = lookup(var.public_api_key_vault_secret_name_overrides, each.value, each.value)
  key_vault_id = module.keyvault.key_vault_id

  depends_on = [
    azurerm_key_vault_secret.initial_secrets
  ]
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

  resource_group_name  = azurerm_resource_group.main.name
  location             = azurerm_resource_group.main.location
  name_prefix          = local.name_prefix
  vnet_cidr            = var.vnet_cidr
  app_subnet_cidr      = var.app_subnet_cidr
  postgres_subnet_cidr = var.postgres_subnet_cidr
  public_ip_sku        = var.public_ip_sku
  tags                 = local.common_tags
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

  resource_group_name             = azurerm_resource_group.main.name
  location                        = azurerm_resource_group.main.location
  name_prefix                     = local.name_prefix
  network_interface_name_override = "${local.name_prefix}-telegram-gateway-nic"
  vm_name_override                = "${local.name_prefix}-telegram-gateway-vm"
  os_disk_name_override           = "${local.name_prefix}-telegram-gateway-osdisk"
  subnet_id                       = module.network.app_subnet_id
  public_ip_id                    = azurerm_public_ip.telegram_gateway[0].id
  vm_size                         = var.telegram_gateway_vm_size
  admin_username                  = var.vm_admin_username
  ssh_public_key                  = var.vm_admin_ssh_public_key
  os_disk_size_gb                 = var.vm_os_disk_size_gb
  app_user                        = var.app_user
  app_directory                   = var.telegram_gateway_app_directory
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

  resource_group_name           = azurerm_resource_group.main.name
  location                      = azurerm_resource_group.main.location
  server_location               = var.postgres_location
  name_prefix                   = local.name_prefix
  server_name                   = var.postgres_server_name
  administrator_login           = var.postgres_admin_username
  administrator_password        = var.postgres_admin_password
  active_directory_auth_enabled = var.postgres_active_directory_auth_enabled
  password_auth_enabled         = var.postgres_password_auth_enabled
  auth_tenant_id                = var.postgres_active_directory_auth_enabled ? coalesce(var.postgres_auth_tenant_id, data.azurerm_client_config.current.tenant_id) : var.postgres_auth_tenant_id
  sku_name                      = var.postgres_sku_name
  postgres_version              = var.postgres_version
  storage_mb                    = var.postgres_storage_mb
  backup_retention_days         = var.postgres_backup_retention_days
  delegated_subnet_id           = module.network.postgres_subnet_id
  virtual_network_id            = module.network.vnet_id
  private_network_enabled       = var.postgres_private_network_enabled
  public_network_access_enabled = var.postgres_public_network_access_enabled
  firewall_rules                = var.postgres_firewall_rules
  database_names                = var.postgres_databases
  zone                          = var.postgres_zone
  tags                          = local.common_tags
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

resource "azurerm_log_analytics_workspace" "container_apps" {
  count               = var.public_api_container_apps_enabled ? 1 : 0
  name                = "${local.name_prefix}-aca-law"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku                 = "PerGB2018"
  retention_in_days   = var.container_apps_log_retention_days
  tags = merge(
    local.common_tags,
    {
      workload = "public-api-container-apps"
    }
  )
}

resource "azurerm_container_app_environment" "public_api" {
  count                      = var.public_api_container_apps_enabled ? 1 : 0
  name                       = "${local.name_prefix}-public-api-aca-env"
  location                   = azurerm_resource_group.main.location
  resource_group_name        = azurerm_resource_group.main.name
  log_analytics_workspace_id = azurerm_log_analytics_workspace.container_apps[0].id
  tags = merge(
    local.common_tags,
    {
      workload = "public-api-container-apps"
    }
  )
}

resource "azurerm_user_assigned_identity" "container_apps" {
  count               = var.public_api_container_apps_enabled ? 1 : 0
  name                = "${local.name_prefix}-aca-mi"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tags = merge(
    local.common_tags,
    {
      workload = "public-api-container-apps"
    }
  )
}

resource "azurerm_key_vault_access_policy" "container_apps" {
  count        = var.public_api_container_apps_enabled ? 1 : 0
  key_vault_id = module.keyvault.key_vault_id
  tenant_id    = data.azurerm_client_config.current.tenant_id
  object_id    = azurerm_user_assigned_identity.container_apps[0].principal_id

  secret_permissions = [
    "Get",
    "List",
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

resource "azapi_resource" "public_api_managed_redis" {
  count     = var.public_api_managed_redis_enabled ? 1 : 0
  type      = "Microsoft.Cache/redisEnterprise@2025-04-01"
  name      = local.public_api_managed_redis_name
  parent_id = azurerm_resource_group.main.id
  location  = azurerm_resource_group.main.location
  tags = merge(
    local.common_tags,
    {
      workload = "public-api-managed-redis"
    }
  )

  body = {
    properties = {
      encryption        = {}
      highAvailability  = var.public_api_managed_redis_high_availability_enabled ? "Enabled" : "Disabled"
      minimumTlsVersion = "1.2"
    }
    sku = {
      name = var.public_api_managed_redis_sku_name
    }
  }

  identity {
    type         = "SystemAssigned"
    identity_ids = []
  }

  schema_validation_enabled = false
  response_export_values    = ["*"]
}

resource "azapi_resource" "public_api_managed_redis_database" {
  count     = var.public_api_managed_redis_enabled ? 1 : 0
  type      = "Microsoft.Cache/redisEnterprise/databases@2025-04-01"
  name      = var.public_api_managed_redis_database_name
  parent_id = azapi_resource.public_api_managed_redis[0].id

  body = {
    properties = {
      accessKeysAuthentication = "Enabled"
      clientProtocol           = "Encrypted"
      clusteringPolicy         = "OSSCluster"
      evictionPolicy           = var.public_api_managed_redis_eviction_policy
      modules                  = []
      port                     = var.public_api_managed_redis_port
    }
  }

  schema_validation_enabled = false
  response_export_values    = ["*"]
}

module "public_api_auth" {
  count  = var.public_api_container_apps_enabled ? 1 : 0
  source = "./modules/container_app"

  name                         = local.public_api_services.auth.name
  resource_group_name          = azurerm_resource_group.main.name
  location                     = azurerm_resource_group.main.location
  container_app_environment_id = azurerm_container_app_environment.public_api[0].id
  user_assigned_identity_id    = azurerm_user_assigned_identity.container_apps[0].id
  image                        = "${var.container_registry_server}/${var.container_registry_namespace}/${local.public_api_services.auth.image_name}:${var.public_api_image_tag}"
  target_port                  = local.public_api_services.auth.port
  ingress_external_enabled     = true
  registry_server              = var.container_registry_server
  registry_username            = var.container_registry_username
  plain_env = merge(
    local.public_api_services.auth.plain_env,
    lookup(var.public_api_extra_plain_env, "auth", {})
  )
  secret_env                    = local.public_api_services.auth.secret_env
  secrets                       = local.public_api_secret_refs_with_managed_redis
  cpu                           = 0.5
  memory                        = "1Gi"
  min_replicas                  = 1
  max_replicas                  = local.public_api_services.auth.max
  concurrent_requests           = 60
  health_path                   = "/health"
  registry_password_secret_name = "ghcr-password"
  tags = merge(
    local.common_tags,
    {
      workload = "public-api"
      service  = "auth"
    }
  )

  depends_on = [
    azurerm_key_vault_access_policy.container_apps
  ]
}

module "public_api_liquid_swap" {
  count  = var.public_api_container_apps_enabled ? 1 : 0
  source = "./modules/container_app"

  name                         = local.public_api_services.liquid_swap.name
  resource_group_name          = azurerm_resource_group.main.name
  location                     = azurerm_resource_group.main.location
  container_app_environment_id = azurerm_container_app_environment.public_api[0].id
  user_assigned_identity_id    = azurerm_user_assigned_identity.container_apps[0].id
  image                        = "${var.container_registry_server}/${var.container_registry_namespace}/${local.public_api_services.liquid_swap.image_name}:${var.public_api_image_tag}"
  target_port                  = local.public_api_services.liquid_swap.port
  ingress_external_enabled     = true
  registry_server              = var.container_registry_server
  registry_username            = var.container_registry_username
  plain_env = merge(
    local.public_api_services.liquid_swap.plain_env,
    lookup(var.public_api_extra_plain_env, "liquid_swap", {}),
    {
      AUTH_SERVICE_URL = try(module.public_api_auth[0].url, "")
    }
  )
  secret_env                    = local.public_api_services.liquid_swap.secret_env
  secrets                       = local.public_api_secret_refs_with_managed_redis
  cpu                           = 0.5
  memory                        = "1Gi"
  min_replicas                  = 1
  max_replicas                  = local.public_api_services.liquid_swap.max
  concurrent_requests           = 60
  health_path                   = "/health"
  registry_password_secret_name = "ghcr-password"
  tags = merge(
    local.common_tags,
    {
      workload = "public-api"
      service  = "liquid-swap"
    }
  )

  depends_on = [
    azurerm_key_vault_access_policy.container_apps
  ]
}

module "public_api_lido" {
  count  = var.public_api_container_apps_enabled ? 1 : 0
  source = "./modules/container_app"

  name                         = local.public_api_services.lido.name
  resource_group_name          = azurerm_resource_group.main.name
  location                     = azurerm_resource_group.main.location
  container_app_environment_id = azurerm_container_app_environment.public_api[0].id
  user_assigned_identity_id    = azurerm_user_assigned_identity.container_apps[0].id
  image                        = "${var.container_registry_server}/${var.container_registry_namespace}/${local.public_api_services.lido.image_name}:${var.public_api_image_tag}"
  target_port                  = local.public_api_services.lido.port
  ingress_external_enabled     = true
  registry_server              = var.container_registry_server
  registry_username            = var.container_registry_username
  plain_env = merge(
    local.public_api_services.lido.plain_env,
    lookup(var.public_api_extra_plain_env, "lido", {})
  )
  secret_env                    = local.public_api_services.lido.secret_env
  secrets                       = local.public_api_secret_refs_with_managed_redis
  cpu                           = 0.5
  memory                        = "1Gi"
  min_replicas                  = 1
  max_replicas                  = local.public_api_services.lido.max
  concurrent_requests           = 60
  health_path                   = "/health"
  registry_password_secret_name = "ghcr-password"
  tags = merge(
    local.common_tags,
    {
      workload = "public-api"
      service  = "lido"
    }
  )

  depends_on = [
    azurerm_key_vault_access_policy.container_apps
  ]
}

module "public_api_lending" {
  count  = var.public_api_container_apps_enabled ? 1 : 0
  source = "./modules/container_app"

  name                         = local.public_api_services.lending.name
  resource_group_name          = azurerm_resource_group.main.name
  location                     = azurerm_resource_group.main.location
  container_app_environment_id = azurerm_container_app_environment.public_api[0].id
  user_assigned_identity_id    = azurerm_user_assigned_identity.container_apps[0].id
  image                        = "${var.container_registry_server}/${var.container_registry_namespace}/${local.public_api_services.lending.image_name}:${var.public_api_image_tag}"
  target_port                  = local.public_api_services.lending.port
  ingress_external_enabled     = true
  registry_server              = var.container_registry_server
  registry_username            = var.container_registry_username
  plain_env = merge(
    local.public_api_services.lending.plain_env,
    lookup(var.public_api_extra_plain_env, "lending", {}),
    {
      AUTH_SERVICE_URL = try(module.public_api_auth[0].url, var.public_api_auth_service_url)
    }
  )
  secret_env                    = local.public_api_services.lending.secret_env
  secrets                       = local.public_api_secret_refs_with_managed_redis
  cpu                           = 0.5
  memory                        = "1Gi"
  min_replicas                  = 1
  max_replicas                  = local.public_api_services.lending.max
  concurrent_requests           = 60
  health_path                   = "/health"
  registry_password_secret_name = "ghcr-password"
  tags = merge(
    local.common_tags,
    {
      workload = "public-api"
      service  = "lending"
    }
  )

  depends_on = [
    azurerm_key_vault_access_policy.container_apps
  ]
}

module "public_api_bridge" {
  count  = var.public_api_container_apps_enabled ? 1 : 0
  source = "./modules/container_app"

  name                         = local.public_api_services.bridge.name
  resource_group_name          = azurerm_resource_group.main.name
  location                     = azurerm_resource_group.main.location
  container_app_environment_id = azurerm_container_app_environment.public_api[0].id
  user_assigned_identity_id    = azurerm_user_assigned_identity.container_apps[0].id
  image                        = "${var.container_registry_server}/${var.container_registry_namespace}/${local.public_api_services.bridge.image_name}:${var.public_api_image_tag}"
  target_port                  = local.public_api_services.bridge.port
  ingress_external_enabled     = true
  registry_server              = var.container_registry_server
  registry_username            = var.container_registry_username
  plain_env = merge(
    local.public_api_services.bridge.plain_env,
    lookup(var.public_api_extra_plain_env, "bridge", {}),
    {
      AUTH_SERVICE_URL        = try(module.public_api_auth[0].url, "")
      LIQUID_SWAP_SERVICE_URL = try(module.public_api_liquid_swap[0].url, "")
      LIDO_SERVICE_URL        = try(module.public_api_lido[0].url, "")
      LENDING_SERVICE_URL     = try(module.public_api_lending[0].url, "")
    }
  )
  secret_env                    = local.public_api_services.bridge.secret_env
  secrets                       = local.public_api_secret_refs_with_managed_redis
  cpu                           = 0.5
  memory                        = "1Gi"
  min_replicas                  = 1
  max_replicas                  = local.public_api_services.bridge.max
  concurrent_requests           = 60
  health_path                   = "/health"
  registry_password_secret_name = "ghcr-password"
  tags = merge(
    local.common_tags,
    {
      workload = "public-api"
      service  = "bridge"
    }
  )

  depends_on = [
    azurerm_key_vault_access_policy.container_apps
  ]
}
