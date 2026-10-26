"""Robomap SSO handoff helpers for payments.robomap.ai.

Reuses the same redirect handshake as aeo.robomap.ai / analytics.robomap.ai:

1. Browser hits GET {ROBOMAP_API_ORIGIN}/auth/sso/handoff?app=payments&returnUrl=...
2. If the shared .robomap.ai session cookie is present, the API redirects back to
   https://payments.robomap.ai/login?access_token=...&returnUrl=...
3. Payments validates the token server-side against the API, then sets its own
   HttpOnly session cookie.

The Robomap API must allowlist app=payments (see docs/SSO.md).
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

DEFAULT_API_ORIGIN = "https://api.robomap.ai"
SSO_APP = "payments"
DEFAULT_LOGIN_PATH = "/login"
DEFAULT_RETURN_PATH = "/app"

# Only robomap.ai and its subdomains may appear in absolute redirect targets.
_ROBOMAP_HOST = re.compile(
    r"^(?:[a-z0-9-]+\.)*robomap\.ai$",
    re.IGNORECASE,
)


def api_origin() -> str:
    return os.environ.get("ROBOMAP_API_ORIGIN", DEFAULT_API_ORIGIN).rstrip("/")


def sso_app() -> str:
    return os.environ.get("ROBOMAP_SSO_APP", SSO_APP)


def payments_public_origin() -> str:
    """Canonical public origin for this host (used in docs / absolute checks)."""
    host = os.environ.get("SITE_HOST", "payments.robomap.ai")
    if host.startswith("http://") or host.startswith("https://"):
        return host.rstrip("/")
    return f"https://{host}"


def is_safe_return_path(value: str | None) -> bool:
    """Allow only same-app relative paths (no scheme, no //, no /auth/)."""
    if not value or not isinstance(value, str):
        return False
    if not value.startswith("/") or value.startswith("//"):
        return False
    if value.startswith("/auth/"):
        return False
    if any(ch in value for ch in ("\\", "\n", "\r", "\0")):
        return False
    # Reject absolute URLs smuggled as paths.
    if "://" in value:
        return False
    return True


def sanitize_return_url(raw: str | None, default: str = DEFAULT_RETURN_PATH) -> str:
    if is_safe_return_path(raw) and raw != "/":
        return raw  # type: ignore[return-value]
    return default


def is_allowed_robomap_absolute_url(url: str) -> bool:
    try:
        parsed = urllib.parse.urlparse(url)
    except ValueError:
        return False
    if parsed.scheme != "https":
        return False
    if not parsed.hostname or not _ROBOMAP_HOST.match(parsed.hostname):
        return False
    return True


def build_handoff_url(return_url: str | None = None) -> str:
    """URL that kicks off the Robomap SSO handoff for this app."""
    params: dict[str, str] = {"app": sso_app()}
    safe = sanitize_return_url(return_url)
    if safe and safe != "/":
        params["returnUrl"] = safe
    return f"{api_origin()}/auth/sso/handoff?{urllib.parse.urlencode(params)}"


def build_oauth_url(provider: str, return_url: str | None = None) -> str:
    """Google/Apple OAuth via the shared Robomap API (same accounts as app)."""
    if provider not in ("google", "apple"):
        raise ValueError("unsupported provider")
    params: dict[str, str] = {"app": sso_app()}
    safe = sanitize_return_url(return_url)
    if safe and safe != "/":
        params["returnUrl"] = safe
    return f"{api_origin()}/auth/{provider}?{urllib.parse.urlencode(params)}"


def _http_get_json(url: str, headers: dict[str, str], timeout: float = 8.0) -> tuple[int, Any]:
    request = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8")
            if not body:
                return response.status, None
            return response.status, json.loads(body)
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw) if raw else None
        except json.JSONDecodeError:
            payload = {"message": raw[:200]}
        return error.code, payload
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError):
        return 0, None


def fetch_user_for_access_token(access_token: str) -> dict[str, Any] | None:
    """Validate a one-time SSO access_token against the Robomap API (server-side)."""
    if not access_token or not isinstance(access_token, str):
        return None
    token = access_token.strip()
    if not token or len(token) > 4096:
        return None
    # Reject obvious non-tokens (e.g. HTML / URLs pasted into the query string).
    if any(ch.isspace() for ch in token) or "://" in token:
        return None

    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
        "User-Agent": "robomap-payments-sso/1.0",
    }
    origin = api_origin()
    for path in ("/auth/me", "/api/user"):
        status, payload = _http_get_json(f"{origin}{path}", headers)
        if status == 200 and isinstance(payload, dict):
            user = normalize_user(payload)
            if user:
                return user
    return None


def normalize_user(payload: dict[str, Any]) -> dict[str, Any] | None:
    """Map API user JSON to the small shape the payments UI needs."""
    data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    user_obj = data.get("user") if isinstance(data.get("user"), dict) else data

    user_id = user_obj.get("id") or user_obj.get("uuid") or user_obj.get("user_id")
    email = user_obj.get("email")
    name = (
        user_obj.get("name")
        or user_obj.get("full_name")
        or " ".join(
            str(part)
            for part in (user_obj.get("first_name"), user_obj.get("last_name"))
            if part
        ).strip()
        or (email.split("@", 1)[0] if isinstance(email, str) and "@" in email else None)
    )
    if not email or not isinstance(email, str):
        return None
    email = email.strip()
    if not email or "@" not in email or len(email) > 320:
        return None
    tag_source = user_obj.get("username") or user_obj.get("tag") or email.split("@", 1)[0]
    tag = str(tag_source).lstrip("@")[:64]
    return {
        "id": str(user_id) if user_id is not None else email,
        "email": email,
        "name": str(name or email)[:200],
        "tag": f"@{tag}" if tag else None,
    }
