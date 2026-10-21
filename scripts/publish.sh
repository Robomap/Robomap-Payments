#!/usr/bin/env bash
# Point payments.robomap.ai at the Robomap Payments Static Web App.
set -euo pipefail

DNS_RG="${AZURE_DNS_RESOURCE_GROUP:-Robomap-APP}"
ZONE="robomap.ai"
HOSTNAME="payments.robomap.ai"
SWA_RG="${STATIC_WEB_APP_RESOURCE_GROUP:-rg-robomap-payments}"
SWA_NAME="${STATIC_WEB_APP_NAME:-robomap-payments}"
PLACEHOLDER_RG="${PLACEHOLDER_RESOURCE_GROUP:-Robomap-APP}"
PLACEHOLDER_APP="${PLACEHOLDER_APP_NAME:-robomap-payments}"

if ! az account show >/dev/null 2>&1; then
  echo "Azure CLI is not signed in. Run: az login" >&2
  exit 1
fi

TARGET="$(az staticwebapp show --name "$SWA_NAME" --resource-group "$SWA_RG" --query defaultHostname -o tsv)"
echo "Subscription: $(az account show --query name -o tsv)"
echo "Static Web App: ${SWA_NAME} (${TARGET})"

if az containerapp hostname list --name "$PLACEHOLDER_APP" --resource-group "$PLACEHOLDER_RG" --query "[?name=='${HOSTNAME}']" -o tsv 2>/dev/null | grep -q "$HOSTNAME"; then
  echo "Removing ${HOSTNAME} from container app ${PLACEHOLDER_APP}."
  az containerapp hostname delete \
    --name "$PLACEHOLDER_APP" \
    --resource-group "$PLACEHOLDER_RG" \
    --hostname "$HOSTNAME" \
    --yes \
    --output none
fi

echo "Pointing ${HOSTNAME} at ${TARGET}."
az network dns record-set cname set-record \
  --resource-group "$DNS_RG" \
  --zone-name "$ZONE" \
  --record-set-name payments \
  --cname "$TARGET" \
  --ttl 300 \
  --output none

if az staticwebapp hostname list --name "$SWA_NAME" --resource-group "$SWA_RG" --query "[?domainName=='${HOSTNAME}']" -o tsv | grep -q "$HOSTNAME"; then
  echo "https://${HOSTNAME} is already bound to ${SWA_NAME}."
  exit 0
fi

echo "Binding ${HOSTNAME} to ${SWA_NAME}."
az staticwebapp hostname set \
  --name "$SWA_NAME" \
  --resource-group "$SWA_RG" \
  --hostname "$HOSTNAME" \
  --validation-method cname-delegation

echo "https://${HOSTNAME} is bound to ${SWA_NAME} in ${SWA_RG}."
echo "Direct app URL: https://${TARGET}"
