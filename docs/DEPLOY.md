# Deploy payments.robomap.ai

## Live hosting (discovered)

| Layer | Value |
|-------|--------|
| Public hostname | `payments.robomap.ai` |
| DNS zone | Azure DNS `robomap.ai` in resource group `Robomap-APP` |
| **Current CNAME (before this cutover)** | Azure Static Web App `thankful-ocean-001b1c403.1.azurestaticapps.net` (`robomap-payments` in `rg-robomap-payments`) |
| **Target host (SSO BFF)** | Container App `robomap-payments` in `Robomap-APP` / environment `robomap` (France Central) |
| ACA FQDN | `robomap-payments.victoriousbush-08a428e1.francecentral.azurecontainerapps.io` |
| Registry | `robomap.azurecr.io` |
| Subscription | `MIM WMS` (`091160e9-bb4d-49c7-978e-033baf447f9a`) |
| Tenant | `74c8231a-7036-4b30-8938-53ed476b07a7` (`groupmim.eu`) |

Sibling hosts (`aeo.robomap.ai`, `analytics.robomap.ai`) already use the same Container Apps environment (`victoriousbush-08a428e1`).

The Static Web App can only serve the SPA. Shared Robomap SSO needs the Python BFF (`src/server.py`), so production must run on the Container App image built from this repo’s `Dockerfile`.

## GitHub Actions (OIDC)

Workflow: [`.github/workflows/deploy-container-app.yml`](../.github/workflows/deploy-container-app.yml)

### Required repository secrets

| Secret | Purpose |
|--------|---------|
| `AZURE_CLIENT_ID` | User-assigned managed identity (or app registration) client id federated to this repo |
| `AZURE_TENANT_ID` | `74c8231a-7036-4b30-8938-53ed476b07a7` |
| `AZURE_SUBSCRIPTION_ID` | `091160e9-bb4d-49c7-978e-033baf447f9a` |
| `PAYMENTS_SESSION_SECRET` | Strong random HMAC key for `robomap_payments_session` (never commit; generate with `openssl rand -base64 48`) |

### Suggested repository / environment variables

| Variable | Default |
|----------|---------|
| `AZURE_RESOURCE_GROUP` | `Robomap-APP` |
| `CONTAINER_APP_ENVIRONMENT` | `robomap` |
| `CONTAINER_APP_NAME` | `robomap-payments` |
| `CONTAINER_REGISTRY` | `robomap` |
| `STATIC_WEB_APP_RESOURCE_GROUP` | `rg-robomap-payments` |
| `STATIC_WEB_APP_NAME` | `robomap-payments` |

Also create a GitHub Environment named `production` (workflow references it).

### Federated credential (Entra)

Subject for environment-scoped OIDC (preferred):

```text
repo:Robomap/Robomap-Payments:environment:production
```

Grant the identity at least: **Contributor** (or narrower) on `Robomap-APP` and `rg-robomap-payments`, plus **AcrPush** on `robomap` ACR, and DNS Zone Contributor on zone `robomap.ai`.

## Manual publish

```bash
az login
export PAYMENTS_SESSION_SECRET="$(openssl rand -base64 48)"   # or reuse an existing vault value
# Store the same value as GitHub secret PAYMENTS_SESSION_SECRET / ACA secret payments-session-secret
bash scripts/publish.sh
```

## Verification

```bash
curl -sSI 'https://payments.robomap.ai/auth/sso/start?returnUrl=/app' | head
# Expect: 302 Location: https://api.robomap.ai/auth/sso/handoff?app=payments&returnUrl=%2Fapp

curl -sSI 'https://payments.robomap.ai/login' | head
# SPA 200 after cutover; browser should call /auth/sso/start and land on the API handoff
```
