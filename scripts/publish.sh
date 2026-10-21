#!/usr/bin/env bash
# Provision Robomap Payments in France Central and attach payments.robomap.ai.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

LOCATION="${AZURE_LOCATION:-francecentral}"
ENV_NAME="${AZURE_ENV_NAME:-payments}"
HOSTNAME="payments.robomap.ai"
ZONE="robomap.ai"

if ! az account show >/dev/null 2>&1; then
  echo "Azure CLI is not signed in. Run: az login" >&2
  exit 1
fi

SUBSCRIPTION_ID="$(az account show --query id -o tsv)"
ACCOUNT_TYPE="$(az account show --query user.type -o tsv)"
if [[ "$ACCOUNT_TYPE" == "user" ]]; then
  PRINCIPAL_ID="$(az ad signed-in-user show --query id -o tsv)"
  PRINCIPAL_TYPE="User"
else
  APP_ID="$(az account show --query user.name -o tsv)"
  PRINCIPAL_ID="$(az ad sp show --id "$APP_ID" --query id -o tsv)"
  PRINCIPAL_TYPE="ServicePrincipal"
fi

echo "Using subscription ${SUBSCRIPTION_ID} in ${LOCATION}."

if ! azd env list --output json 2>/dev/null | python3 -c 'import json,sys; names=[e.get("Name") or e.get("name") for e in json.load(sys.stdin)]; sys.exit(0 if "payments" in names else 1)'; then
  azd env new "$ENV_NAME" --location "$LOCATION" --subscription "$SUBSCRIPTION_ID"
fi
azd env select "$ENV_NAME"
azd env set AZURE_LOCATION "$LOCATION"
azd env set AZURE_SUBSCRIPTION_ID "$SUBSCRIPTION_ID"
azd env set AZURE_PRINCIPAL_ID "$PRINCIPAL_ID"
azd env set AZURE_PRINCIPAL_TYPE "$PRINCIPAL_TYPE"

echo "Previewing the France Central Container Apps deployment."
azd provision --preview --no-prompt

echo "Provisioning infrastructure."
provisioned=0
for attempt in 1 2 3; do
  if azd provision --no-prompt; then
    provisioned=1
    break
  fi
  echo "Provision attempt ${attempt} failed. Retrying so Key Vault role assignments can propagate."
  sleep 30
done
if [[ "$provisioned" != 1 ]]; then
  echo "Azure provision did not succeed." >&2
  exit 1
fi

REGISTRY="$(azd env get-value AZURE_CONTAINER_REGISTRY_NAME || true)"
APP_NAME="$(azd env get-value SERVICE_WEB_NAME || true)"
RESOURCE_GROUP="$(azd env get-value AZURE_RESOURCE_GROUP || true)"

if [[ -z "$REGISTRY" || -z "$APP_NAME" || -z "$RESOURCE_GROUP" || "$REGISTRY" == "ERROR:"* ]]; then
  echo "Provision did not return the container app outputs." >&2
  azd env get-values
  exit 1
fi

echo "Building the payments image in ${REGISTRY} (no local Docker daemon)."
az acr build \
  --registry "$REGISTRY" \
  --image "robomap-payments:latest" \
  --file Dockerfile \
  .

IMAGE="${REGISTRY}.azurecr.io/robomap-payments:latest"
echo "Updating ${APP_NAME} to ${IMAGE}."
az containerapp update \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --image "$IMAGE" \
  --set-env-vars PORT=80

FQDN="$(az containerapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --query properties.configuration.ingress.fqdn -o tsv)"
VERIFICATION_ID="$(az containerapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --query properties.customDomainVerificationId -o tsv)"
ENVIRONMENT_ID="$(az containerapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --query properties.managedEnvironmentId -o tsv)"
ENVIRONMENT_NAME="${ENVIRONMENT_ID##*/}"
ENVIRONMENT_RG="$(echo "$ENVIRONMENT_ID" | awk -F/ '{for (i=1;i<=NF;i++) if ($i=="resourceGroups") print $(i+1)}')"

echo "Container app hostname: https://${FQDN}"

python3 - << PY
import json, subprocess, sys
wanted = "${ZONE}"
found = None
subs = json.loads(subprocess.check_output(["az","account","list","--query","[?state=='Enabled'].id","-o","json"]))
for sub in subs:
    zones = json.loads(subprocess.check_output(["az","network","dns","zone","list","--subscription",sub,"-o","json"]))
    for zone in zones:
        if zone.get("name") == wanted:
            found = {"subscription": sub, "resourceGroup": zone["resourceGroup"]}
            break
    if found:
        break
if not found:
    sys.exit("Azure DNS zone robomap.ai was not found in the signed-in subscriptions.")
open("/tmp/robomap-dns-zone.json","w").write(json.dumps(found))
print(f"DNS zone {wanted} is in {found['resourceGroup']} ({found['subscription']}).")
PY

DNS_JSON="$(cat /tmp/robomap-dns-zone.json)"
DNS_SUB="$(python3 -c 'import json; print(json.load(open("/tmp/robomap-dns-zone.json"))["subscription"])')"
DNS_RG="$(python3 -c 'import json; print(json.load(open("/tmp/robomap-dns-zone.json"))["resourceGroup"])')"

echo "Pointing ${HOSTNAME} at ${FQDN}."
az network dns record-set cname set-record \
  --subscription "$DNS_SUB" \
  --resource-group "$DNS_RG" \
  --zone-name "$ZONE" \
  --record-set-name payments \
  --cname "$FQDN"

az network dns record-set txt delete \
  --subscription "$DNS_SUB" \
  --resource-group "$DNS_RG" \
  --zone-name "$ZONE" \
  --name asuid.payments \
  --yes >/dev/null 2>&1 || true

az network dns record-set txt add-record \
  --subscription "$DNS_SUB" \
  --resource-group "$DNS_RG" \
  --zone-name "$ZONE" \
  --record-set-name asuid.payments \
  --value "$VERIFICATION_ID"

echo "Binding the managed certificate for ${HOSTNAME}."
az containerapp hostname add \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --hostname "$HOSTNAME" >/dev/null 2>&1 || true

bound=0
for attempt in 1 2 3 4 5 6; do
  if az containerapp hostname bind \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --hostname "$HOSTNAME" \
    --environment "$ENVIRONMENT_NAME" \
    --validation-method CNAME; then
    bound=1
    break
  fi
  echo "Certificate validation is waiting for DNS (attempt ${attempt})."
  sleep 20
done
if [[ "$bound" != 1 ]]; then
  echo "The app is deployed at https://${FQDN}, but ${HOSTNAME} is not bound yet." >&2
  exit 1
fi

echo "https://${HOSTNAME} is bound to ${APP_NAME} in ${RESOURCE_GROUP} (environment ${ENVIRONMENT_NAME} / ${ENVIRONMENT_RG})."
echo "Direct app URL: https://${FQDN}"
