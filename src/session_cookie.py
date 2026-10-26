"""Signed HttpOnly session cookie for the payments host.

The cookie is scoped to the payments host (not .robomap.ai). The shared
Robomap identity still comes from the API SSO handoff; this cookie only
proves that payments already validated the one-time access_token.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Any

COOKIE_NAME = "robomap_payments_session"
DEFAULT_TTL_SECONDS = 60 * 60 * 12  # 12 hours


def _secret() -> bytes:
    raw = os.environ.get("PAYMENTS_SESSION_SECRET") or os.environ.get("SESSION_SECRET")
    if not raw:
        # Dev-only fallback so local tests boot without secrets. Production
        # must set PAYMENTS_SESSION_SECRET (see docs/SSO.md).
        raw = "dev-only-payments-session-secret-change-me"
    return raw.encode("utf-8")


def session_ttl_seconds() -> int:
    try:
        return max(300, int(os.environ.get("PAYMENTS_SESSION_TTL", DEFAULT_TTL_SECONDS)))
    except ValueError:
        return DEFAULT_TTL_SECONDS


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    pad = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + pad)


def issue_session(user: dict[str, Any], now: int | None = None) -> str:
    issued = int(time.time() if now is None else now)
    payload = {
        "v": 1,
        "iat": issued,
        "exp": issued + session_ttl_seconds(),
        "user": {
            "id": str(user["id"]),
            "email": str(user["email"]),
            "name": str(user.get("name") or user["email"]),
            "tag": user.get("tag"),
        },
    }
    body = _b64url(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    sig = _b64url(hmac.new(_secret(), body.encode("ascii"), hashlib.sha256).digest())
    return f"{body}.{sig}"


def verify_session(token: str | None, now: int | None = None) -> dict[str, Any] | None:
    if not token or not isinstance(token, str) or token.count(".") != 1:
        return None
    body, sig = token.split(".", 1)
    expected = _b64url(hmac.new(_secret(), body.encode("ascii"), hashlib.sha256).digest())
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        payload = json.loads(_b64url_decode(body).decode("utf-8"))
    except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
        return None
    if not isinstance(payload, dict) or payload.get("v") != 1:
        return None
    exp = payload.get("exp")
    current = int(time.time() if now is None else now)
    if not isinstance(exp, int) or current >= exp:
        return None
    user = payload.get("user")
    if not isinstance(user, dict) or not user.get("email"):
        return None
    return {
        "id": str(user.get("id") or user["email"]),
        "email": str(user["email"]),
        "name": str(user.get("name") or user["email"]),
        "tag": user.get("tag"),
    }


def parse_cookie_header(header: str | None, name: str = COOKIE_NAME) -> str | None:
    if not header:
        return None
    for part in header.split(";"):
        piece = part.strip()
        if not piece or "=" not in piece:
            continue
        key, value = piece.split("=", 1)
        if key.strip() == name:
            return value.strip()
    return None


def set_cookie_header(token: str, *, secure: bool = True) -> str:
    parts = [
        f"{COOKIE_NAME}={token}",
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        f"Max-Age={session_ttl_seconds()}",
    ]
    if secure:
        parts.append("Secure")
    return "; ".join(parts)


def clear_cookie_header(*, secure: bool = True) -> str:
    parts = [
        f"{COOKIE_NAME}=",
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        "Max-Age=0",
    ]
    if secure:
        parts.append("Secure")
    return "; ".join(parts)
