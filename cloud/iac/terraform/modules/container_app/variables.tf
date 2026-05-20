variable "name" {
  description = "Container App name."
  type        = string
}

variable "resource_group_name" {
  description = "Resource group name."
  type        = string
}

variable "location" {
  description = "Azure region."
  type        = string
}

variable "container_app_environment_id" {
  description = "Container Apps Environment resource ID."
  type        = string
}

variable "user_assigned_identity_id" {
  description = "User-assigned managed identity used by the app to read Key Vault secrets."
  type        = string
}

variable "image" {
  description = "Container image reference."
  type        = string
}

variable "container_name" {
  description = "Container name inside the app template."
  type        = string
  default     = null
}

variable "target_port" {
  description = "Ingress target port and health probe port."
  type        = number
}

variable "ingress_external_enabled" {
  description = "Expose ingress publicly when true."
  type        = bool
  default     = true
}

variable "registry_server" {
  description = "Container registry server."
  type        = string
}

variable "registry_identity" {
  description = "User-assigned managed identity resource ID used to pull from the container registry."
  type        = string
}

variable "plain_env" {
  description = "Plain environment variables."
  type        = map(string)
  default     = {}
}

variable "secret_env" {
  description = "Environment variables whose values come from Container Apps secrets. Map env var name to secret name."
  type        = map(string)
  default     = {}
}

variable "secrets" {
  description = "Container Apps secrets backed by Key Vault references."
  type = map(object({
    key_vault_secret_id = string
  }))
  default = {}
}

variable "cpu" {
  description = "Container CPU."
  type        = number
  default     = 0.5
}

variable "memory" {
  description = "Container memory."
  type        = string
  default     = "1Gi"
}

variable "min_replicas" {
  description = "Minimum replicas."
  type        = number
  default     = 1
}

variable "max_replicas" {
  description = "Maximum replicas."
  type        = number
  default     = 5
}

variable "concurrent_requests" {
  description = "HTTP autoscale concurrent request threshold."
  type        = number
  default     = 60
}

variable "health_path" {
  description = "HTTP health probe path."
  type        = string
  default     = "/health"
}

variable "tags" {
  description = "Resource tags."
  type        = map(string)
  default     = {}
}
