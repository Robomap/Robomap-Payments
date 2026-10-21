# Robomap Payments

Payments host for [robomap.ai](https://robomap.ai/), published at `https://payments.robomap.ai`.

The service is a Python HTTP app. `GET /` is the public page and `GET /health` returns JSON. It does not collect card numbers.

Azure hosting is a consumption Container App in France Central, the same region as the live Robomap site. Infrastructure is in `infra/` and is applied with the Azure Developer CLI. `scripts/publish.sh` provisions that stack, builds the image in Azure Container Registry, and creates the `payments` CNAME on the `robomap.ai` Azure DNS zone.

```bash
az login
bash scripts/publish.sh
```
