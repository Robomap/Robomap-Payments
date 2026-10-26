# Robomap Payments SSO

Payments reuses the **same SSO handoff** already used by `aeo.robomap.ai`, `analytics.robomap.ai`, and other `*.robomap.ai` subdomains — not a new auth protocol.

## How it works

1. User opens `https://payments.robomap.ai/login` (or is redirected there from a protected route).
2. The SPA calls `GET /auth/sso/start?returnUrl=/app` on this host.
3. The payments BFF redirects to:

   ```
   GET {ROBOMAP_API_ORIGIN}/auth/sso/handoff?app=payments&returnUrl=/app
   ```

4. The Robomap API reads the shared session cookies (`robomap_session` + `XSRF-TOKEN` on `Domain=.robomap.ai`, `Secure`, `SameSite=None`) and:
   - **Logged in** → `302` to `https://payments.robomap.ai/login?access_token=...&returnUrl=...`
   - **Logged out** → `302` to `https://payments.robomap.ai/login?sso=0&returnUrl=...`
5. The SPA POSTs `{ access_token }` to `POST /api/auth/session`.
6. The BFF validates the token **server-side** with `Authorization: Bearer …` against `{ROBOMAP_API_ORIGIN}/auth/me` (fallback `/api/user`), then sets an HttpOnly `robomap_payments_session` cookie scoped to the payments host.
7. Google / Apple buttons go through `GET /auth/oauth/{google|apple}` → `{API}/auth/{provider}?app=payments&returnUrl=…` (same shared accounts as `app.robomap.ai`).

Client helpers live in `web/src/lib/robomapSso.ts` and intentionally mirror `aeo/src/lib/robomapSso.ts` (`ROBOMAP_SSO_TRIED`, `sanitizeReturnUrl`, `beginRobomapSsoHandoff`, `sso=0` bounce handling).

## Required change in Robomap/Robomap (API allowlist)

Today `app=payments` is **not** registered, so the handoff falls back to `https://app.robomap.ai/auth/login`. Payments needs an allowlist entry:

| `app` key  | `login_url`                             |
|------------|-----------------------------------------|
| `payments` | `https://payments.robomap.ai/login`     |

Use `/login` (same style as analytics), **not** `/auth/login`.

Likely touch points in the monorepo (names from existing tests / config):

- Handoff route + tests: `backend/tests/Feature/SsoHandoffTest.php`
- OAuth redirect allowlist tests: `backend/tests/Feature/AeoOAuthRedirectTest.php`
- Stateful domains / cookie domain: `backend/config/sanctum.php` (ensure `payments.robomap.ai` is covered by the shared `.robomap.ai` cookie domain — typically already true if Sanctum uses `robomap.ai`)
- AEO reference client: `aeo/src/lib/robomapSso.ts`, `aeo/tests/robomapSso.test.ts`

Suggested allowlist snippet (shape inferred from live handoff behaviour):

```php
'payments' => [
    'login_url' => 'https://payments.robomap.ai/login',
],
```

Also add `payments` to any OAuth `app` → redirect allowlist covered by `AeoOAuthRedirectTest` so Google/Apple return to payments with `access_token` (or the provider callback → handoff chain already used by AEO).

After that lands in production, logged-in `app.robomap.ai` users hitting payments auto-complete SSO without seeing the login form.

## Environment variables (payments host)

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `ROBOMAP_API_ORIGIN` | no | `https://api.robomap.ai` | API base for handoff + token validation |
| `ROBOMAP_SSO_APP` | no | `payments` | `app=` query value on handoff / OAuth |
| `PAYMENTS_SESSION_SECRET` | **yes in prod** | dev fallback | HMAC key for `robomap_payments_session` |
| `PAYMENTS_SESSION_TTL` | no | `43200` (12h) | Session cookie lifetime (seconds, min 300) |
| `COOKIE_SECURE` | no | `1` | Set `0` only for local HTTP |
| `SITE_HOST` | no | `payments.robomap.ai` | Host reported in `/health` |
| `PORT` | no | `8080` (Docker: `80`) | Listen port |
| `STATIC_ROOT` | no | `web/dist` | Built SPA directory |

Never put API client secrets or the session HMAC in the browser bundle. The SPA only ever sees a one-time `access_token` in the URL, which is exchanged once and stripped from history.

## Why handoff (not browser cookie SSO)

Live production already sets `robomap_session` / `XSRF-TOKEN` on `Domain=.robomap.ai; Secure; SameSite=None`, and `POST /auth/login` CORS already allows `https://payments.robomap.ai`. That looks like “just call `/auth/me` with credentials from the SPA,” but:

- `GET /auth/me` (and its OPTIONS preflight) often omit `Access-Control-Allow-*`, so a credentialed browser `fetch` from payments is blocked even when the cookie is present.
- The Angular app’s `access_token` lives in **sessionStorage** (per-origin) — it is not shared with payments.
- App login `returnUrl` only accepts same-app relative paths; absolute `https://payments.robomap.ai/...` is rejected unless the monorepo handoff/OAuth allowlist is used.

The AEO-style handoff avoids those gaps: the API reads the shared cookie on a top-level navigation, returns a one-time `access_token` to payments `/login`, and payments validates it **server-side** (no cross-origin credentialed XHR required for session establishment).

Also confirm in `backend/config/sanctum.php` that `payments.robomap.ai` is on `SANCTUM_STATEFUL_DOMAINS` (or equivalent). Cookie `SESSION_DOMAIN=.robomap.ai` is already correct in production.

## Security notes

- Return URLs are sanitized to same-origin relative paths (no `//`, no scheme, no `/auth/*`).
- Access tokens are validated only on the server; invalid / garbage tokens never create a session.
- The payments session cookie is `HttpOnly`, `SameSite=Lax`, host-scoped (not `.robomap.ai`).
- Redirect targets for absolute URLs are restricted to `*.robomap.ai` over HTTPS where absolute checks apply.

## Local development

```bash
# Terminal 1 — BFF (uses COOKIE_SECURE=0)
export COOKIE_SECURE=0
export PAYMENTS_SESSION_SECRET=local-dev-secret
export ROBOMAP_API_ORIGIN=https://api.robomap.ai   # or local API
cd web && npm install && npm run build && cd ..
python src/server.py

# Or front-end only against a running BFF:
cd web && npm run dev
```

Without the API allowlist entry, `/auth/sso/start` still redirects to the handoff URL, but the API will bounce unauthenticated users to `app.robomap.ai` instead of payments `/login?sso=0`.
