# Cost Estimation And Optimization

## Recommended Baseline

- **VM**: `Standard_B1ms` for initial testing
- **Managed disk**: Standard SSD, 64 GiB
- **Database**: Azure Database for PostgreSQL Flexible Server `B_Standard_B1ms`, 32 GiB storage, no HA
- **Key Vault**: standard tier, low transaction volume
- **Networking**: 1 static public IP, 1 VNet, 2 subnets

## Estimated Monthly Cost

These figures are **directional estimates**, not quoted prices. Microsoft’s public pricing pages expose the product/SKU structure clearly, but the scraped HTML does not reliably render the live per-region dollar values. The ranges below are inferred from typical pay-as-you-go pricing in low-cost US regions and should be checked in the Azure Pricing Calculator before purchase.

| Component | Recommended SKU | Estimated monthly cost |
|---|---|---:|
| Linux VM | Standard_B1ms | $10-18 |
| OS disk | Standard SSD 64 GiB | $3-5 |
| Public IP | Standard static IPv4 | $2-4 |
| PostgreSQL Flexible Server | Burstable B1ms | $12-20 |
| PostgreSQL storage + backup | 32 GiB + 7-day retention | $2-6 |
| Key Vault | Standard, low secret ops | <$1 |
| Data transfer / misc | Low traffic dev usage | $0-5 |
| **Total** |  | **~$29-59/month** |

## Free Credit Fit

For a new Azure free account, Microsoft currently advertises:

- **750 hours of Azure Database for PostgreSQL Flexible Server Burstable B1MS with 32 GB storage and 32 GB backup storage for 12 months**
- **750 hours each of B1s, B2pts v2, and B2ats v2 virtual machines for 12 months**
- **$200 free credit at account start**

Implication:

- PostgreSQL may be almost fully covered for the first year if you stay within the free entitlement.
- Your exact chosen VM size matters. `B1ms` is **not** the same as the free `B1s` entitlement, so if credits are the priority, consider testing `B1s` first and moving to `B1ms` only if memory becomes a bottleneck.

## Cheapest Viable Recommendation

### Option A: lowest cost

- VM: `Standard_B1s`
- DB: PostgreSQL `B_Standard_B1ms`
- Redis: disabled unless required

Expected outcome:

- Lowest monthly bill
- Highest risk of memory pressure with ~10 containers

### Option B: safest low-cost default

- VM: `Standard_B1ms`
- DB: PostgreSQL `B_Standard_B1ms`
- Redis: optional compatibility profile only

Expected outcome:

- Better memory headroom
- Still far below typical multi-service ACA cost

## Cost Optimization Actions

- Start with one environment only. Do not provision staging in Azure yet.
- Keep PostgreSQL zone redundancy disabled until real users exist.
- Use Standard SSD, not Premium SSD.
- Use GHCR instead of Azure Container Registry to avoid another always-on Azure bill.
- Disable optional Redis unless at least one service still hard-requires it.
- Rotate and prune old Docker images on the VM.
- Use one shared PostgreSQL server with multiple databases instead of one database server per service.
- Keep observability lightweight at first; avoid Application Gateway, Front Door Premium, AKS, and managed Redis.

## When To Scale

Move from this design when one of these happens:

- VM memory stays above 80% under normal load
- deployments become risky because one host restart affects everything
- one or two services need independent scaling
- request volume grows enough that managed ingress and autoscaling become worth the platform cost

## Sources

- https://azure.microsoft.com/en-us/pricing/purchase-options/azure-account
- https://azure.microsoft.com/en-us/pricing/details/postgresql/flexible-server/
- https://azure.microsoft.com/en-us/products/virtual-machines/linux/
- https://azure.microsoft.com/en-us/pricing/details/key-vault/
