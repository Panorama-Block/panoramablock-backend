# Feature Status Report

> Auto-generated mapping of implemented work to capability lanes.
> Update this file when features ship or move between phases.

## Capability Lanes

| Lane | Service | Port | Adapters | Routes | Tests | Status |
|---|---|---|---|---|---|---|
| **swap** | liquid-swap-service | ISwapProvider | Uniswap (2), Aerodrome, Thirdweb, Multihop, TraderJoe | /v1/capability/swap/* | 39 | Live |
| **staking** | lido-service | IStakingProvider | LidoProvider, BaseStakingStub | /v1/capability/staking/* | 45 | Live |
| **liquidity** | liquidity-service | ILiquidityProvider | AerodromeLp, TraderJoeLpStub | /v1/capability/liquidity/* | 14 | Live |
| **lending** | lending-service | ILendingProvider | BenqiAdapter, ExecutionLayerAdapter, EthereumStub | /v1/capability/lend/* | 7 | Live |
| **automation** | dca-service | IDCAProvider | ERC4337DCAAdapter | /v1/capability/dca/* | 7 | Live |
| **bridge** | bridge-service | IBridgeProvider | LayerswapBridgeAdapter | /v1/capability/bridge/* | 8 | Live |
| **auth** | auth-service | IAuthProvider | ThirdwebAuth, TelegramAuth | /v1/capability/auth/* | 7 | Live |
| **agent** | agents-service | IAgentProvider | Anthropic, OpenAI, Groq, ZicoHF | — | — | Live (no tests) |
| **monitoring** | monitoring-service | — | — | /v1/monitoring/* | 3 | Live |
| **portfolio** | portfolio-service | — | — | /v1/portfolio/* | 3 | Live |

## Shared Packages

| Package | Tests | Description |
|---|---|---|
| @panorama/capability | 202 | Registry, Policy, Health, Discovery, Errors, Envelope, Chains |
| @panorama/execution-planning | 10 | Plan builder, validator, topological sort |

## Infrastructure

| Component | Status |
|---|---|
| Chain manifests | base, ethereum, avalanche, arbitrum, ton |
| Gateway capability proxy | Live (telegram gateway) |
| Aggregated discovery | Live (/v1/capability/_discovery) |
| Deprecation headers | Active on legacy /swap/*, /api/lido/* |
| Smart contracts (Base) | Pending deploy (needs ETH) |

## Total Test Count: 345+
