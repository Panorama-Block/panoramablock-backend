# Public API Gateway Recovery Evidence

## Historical Azure workload

Container App:

    panorama-dev-public-api-gateway

Resource group:

    rg-panorama-dev

Historical image:

    panoramadevpublicapi.azurecr.io/public-api-gateway:latest

Historical ACR manifest digest:

    sha256:dcc28685bf5b4380dcba159a6c05710bf8d22328a06df4697ac6fdc17f17ab25

Historical local Docker image ID:

    sha256:c0c5b8b53e6eca43028ac2d950ce452b3f593e9f989f1f470a4aec248fec8d31

Historical image creation time:

    2026-05-27T16:22:18.360676764+02:00

Historical Container App revision:

    panorama-dev-public-api-gateway--a3sn3qq

## Recovered application artefact

The Caddyfile was recovered directly from the historical ACR image deployed to Azure.

SHA-256:

    926fd6647a6d1e7ea2f7454cf2401547fd21e5af774e841552cfb555f19e4891

Three copies were independently compared:

1. Artefact recovered from the historical Azure/ACR investigation
2. File extracted directly from the historical Docker image
3. Reconstructed repository source

All three SHA-256 hashes were identical.

## Historical image construction

Docker image history shows the application-specific image layer as:

    COPY Caddyfile /etc/caddy/Caddyfile

The underlying image identifies itself as Caddy v2.8.4.

The reconstructed Dockerfile is therefore:

    FROM caddy:2.8.4-alpine

    COPY Caddyfile /etc/caddy/Caddyfile

## Historical source-control status

Searches were performed across:

- all reachable panoramablock-backend Git history
- pull-request refs
- unreachable/dangling Git objects
- other locally recovered PanoramaBlock repositories
- GitHub organisation code search

No source-controlled copy of this public API gateway Caddyfile or its identifying strings was found.

The deployed ACR image and Azure resource therefore constitute the recovered source-of-truth evidence for this artefact.
