# Robomap Payments

Payments host for [robomap.ai](https://robomap.ai/), published at `https://payments.robomap.ai`.

The service is a Python HTTP app. `GET /` is the public page and `GET /health` returns JSON. It does not collect card numbers.

The live host is the existing Container App `robomap-payments` in resource group `Robomap-APP`, environment `robomap`, France Central, using registry `robomap.azurecr.io`. `scripts/publish.sh` builds the image there, updates the app, and points the `payments` CNAME on the `robomap.ai` Azure DNS zone at it. `infra/` is a standalone Bicep layout and is not what the publish script applies.

```bash
az login
bash scripts/publish.sh
```
