# Robomap Payments

Robomap Payments is published at [https://payments.robomap.ai](https://payments.robomap.ai).

The live site is the Azure Static Web App `robomap-payments` in resource group `rg-robomap-payments` (West Europe). `scripts/publish.sh` points the `payments` CNAME on the `robomap.ai` Azure DNS zone at that app and binds the hostname.

```bash
az login
bash scripts/publish.sh
```

The Python process in `src/` is a separate health page and is not the published product.
