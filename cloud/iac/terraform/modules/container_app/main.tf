locals {
  container_name = coalesce(var.container_name, var.name)
}

resource "azurerm_container_app" "this" {
  name                         = var.name
  resource_group_name          = var.resource_group_name
  container_app_environment_id = var.container_app_environment_id
  revision_mode                = "Single"
  tags                         = var.tags

  lifecycle {
    ignore_changes = [
      template[0].container[0].image,
    ]
  }

  identity {
    type         = "UserAssigned"
    identity_ids = [var.user_assigned_identity_id]
  }

  registry {
    server   = var.registry_server
    identity = var.registry_identity
  }

  dynamic "secret" {
    for_each = var.secrets

    content {
      name                = secret.key
      key_vault_secret_id = secret.value.key_vault_secret_id
      identity            = var.user_assigned_identity_id
    }
  }

  ingress {
    external_enabled           = var.ingress_external_enabled
    target_port                = var.target_port
    transport                  = "auto"
    allow_insecure_connections = false

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas = var.min_replicas
    max_replicas = var.max_replicas

    container {
      name   = local.container_name
      image  = var.image
      cpu    = var.cpu
      memory = var.memory

      dynamic "env" {
        for_each = var.plain_env

        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = var.secret_env

        content {
          name        = env.key
          secret_name = env.value
        }
      }

      liveness_probe {
        transport               = "HTTP"
        port                    = var.target_port
        path                    = var.health_path
        initial_delay           = 30
        interval_seconds        = 30
        timeout                 = 5
        failure_count_threshold = 5
      }

      readiness_probe {
        transport               = "HTTP"
        port                    = var.target_port
        path                    = var.health_path
        interval_seconds        = 10
        timeout                 = 5
        failure_count_threshold = 3
      }
    }

    http_scale_rule {
      name                = "http-rps"
      concurrent_requests = var.concurrent_requests
    }
  }
}
