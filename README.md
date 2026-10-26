# Robomap Payments

Robomap Payments is published at [https://payments.robomap.ai](https://payments.robomap.ai).

## Auth (shared Robomap SSO)

This host uses the **same SSO handoff** as `aeo.robomap.ai` and other subdomains:

`/auth/sso/start` → `api.robomap.ai/auth/sso/handoff?app=payments` → `/login?access_token=…` → server-side exchange → HttpOnly session cookie.

Full flow, env vars, and the **required Robomap API allowlist entry** (`payments` → `https://payments.robomap.ai/login`) are documented in [`docs/SSO.md`](docs/SSO.md).

## Architecture

| Piece | Role |
|-------|------|
| `web/` | Vite + React SPA (balances demo UI + SSO login) |
| `src/server.py` | Python BFF: health, SSO start, OAuth redirect, session exchange, static `web/dist` |
| `src/sso.py` | Handoff URL builders + Bearer token validation against the Robomap API |
| `src/session_cookie.py` | Signed `robomap_payments_session` cookie |

The live product can still be published as an Azure Static Web App (`scripts/publish.sh`). The Container App image built from this Dockerfile serves SPA + SSO together.

## Local run

```bash
cd web && npm install && npm run build && cd ..
export COOKIE_SECURE=0
export PAYMENTS_SESSION_SECRET=local-dev-secret
python src/server.py
# → http://127.0.0.1:8080
```

## Tests

```bash
cd src && python -m unittest test_sso test_server -v
```

## Deploy

```bash
az login
bash scripts/publish.sh   # CNAME + SWA hostname (existing path)
# or: azd up                # Container App via azure.yaml + Dockerfile
```

Required production secrets: `PAYMENTS_SESSION_SECRET`. Optional: `ROBOMAP_API_ORIGIN`, `ROBOMAP_SSO_APP`.
