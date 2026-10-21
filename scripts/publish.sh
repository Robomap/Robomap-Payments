#!/usr/bin/env bash
# Publish Robomap Payments into the existing France Central Container Apps environment.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RG="${AZURE_RESOURCE_GROUP:-Robomap-APP}"
ENVIRONMENT="${CONTAINER_APP_ENVIRONMENT:-robomap}"
APP="${CONTAINER_APP_NAME:-robomap-payments}"
ACR="${CONTAINER_REGISTRY:-robomap}"
HOSTNAME="payments.robomap.ai"
ZONE="robomap.ai"
TAG="$(git rev-parse --short HEAD)"
IMAGE="${ACR}.azurecr.io/${APP}:${TAG}"

if ! az account show >/dev/null 2>&1; then
  echo "Azure CLI is not signed in. Run: az login" >&2
  exit 1
fi

echo "Subscription: $(az account show --query name -o tsv)"
echo "Building ${IMAGE} in registry ${ACR}."
az acr build \
  --registry "$ACR" \
  --image "${APP}:${TAG}" \
  --file Dockerfile \
  .

if ! az containerapp show --resource-group "$RG" --name "$APP" >/dev/null 2>&1; then
  echo "Creating ${APP} in ${RG} / ${ENVIRONMENT}."
  az containerapp create \
    --name "$APP" \
    --resource-group "$RG" \
    --environment "$ENVIRONMENT" \
    --image "$IMAGE" \
    --registry-server "${ACR}.azurecr.io" \
    --registry-username "$ACR" \
    --registry-password "$(az acr credential show --name "$ACR" --query 'passwords[0].value' -o tsv)" \
    --target-port 80 \
    --ingress external \
    --min-replicas 1 \
    --max-replicas 2 \
    --cpu 0.25 \
    --memory 0.5Gi \
    --env-vars PORT=80 SITE_HOST="$HOSTNAME" \
    --output none
else
  echo "Updating ${APP}."
  az containerapp update \
    --name "$APP" \
    --resource-group "$RG" \
    --image "$IMAGE" \
    --set-env-vars PORT=80 SITE_HOST="$HOSTNAME" \
    --output none
fi

FQDN="$(az containerapp show --name "$APP" --resource-group "$RG" --query properties.configuration.ingress.fqdn -o tsv)"
VERIFICATION_ID="$(az containerapp env show --name "$ENVIRONMENT" --resource-group "$RG" --query properties.customDomainConfiguration.customDomainVerificationId -o tsv)"
echo "Container app hostname: https://${FQDN}"

echo "Pointing ${HOSTNAME} at ${FQDN}."
az network dns record-set cname set-record \
  --resource-group "$RG" \
  --zone-name "$ZONE" \
  --record-set-name payments \
  --cname "$FQDN" \
  --output none

az network dns record-set txt delete \
  --resource-group "$RG" \
  --zone-name "$ZONE" \
  --name asuid.payments \
  --yes >/dev/null 2>&1 || true

az network dns record-set txt add-record \
  --resource-group "$RG" \
  --zone-name "$ZONE" \
  --record-set-name asuid.payments \
  --value "$VERIFICATION_ID" \
  --output none

echo "Binding the managed certificate for ${HOSTNAME}."
az containerapp hostname add \
  --name "$APP" \
  --resource-group "$RG" \
  --hostname "$HOSTNAME" >/dev/null 2>&1 || true

bound=0
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if az containerapp hostname bind \
    --name "$APP" \
    --resource-group "$RG" \
    --hostname "$HOSTNAME" \
    --environment "$ENVIRONMENT" \
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

echo "https://${HOSTNAME} is bound to ${APP} in ${RG} (environment ${ENVIRONMENT})."
echo "Direct app URL: https://${FQDN}"
