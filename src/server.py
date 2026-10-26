"""Robomap Payments HTTP host with Robomap SSO.

Binds to 0.0.0.0 and PORT (default 8080). Serves the payments SPA from
web/dist when present, and exchanges Robomap SSO access_tokens for a
payments session cookie after server-side validation.
"""

from __future__ import annotations

import json
import mimetypes
import os
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import session_cookie
import sso

SERVICE = "robomap-payments"
DEFAULT_SITE_HOST = "payments.robomap.ai"
STATIC_ROOT = Path(os.environ.get("STATIC_ROOT", Path(__file__).resolve().parent.parent / "web" / "dist"))


def site_host() -> str:
    return os.environ.get("SITE_HOST", DEFAULT_SITE_HOST)


def listen_port() -> int:
    return int(os.environ.get("PORT", "8080"))


def health_payload() -> dict[str, str]:
    return {"status": "ok", "service": SERVICE, "host": site_host()}


def _json_bytes(payload: object) -> bytes:
    return json.dumps(payload, separators=(",", ":")).encode("utf-8")


def _read_json_body(handler: BaseHTTPRequestHandler, limit: int = 32_768) -> dict | None:
    length = int(handler.headers.get("Content-Length") or "0")
    if length <= 0 or length > limit:
        return None
    raw = handler.rfile.read(length)
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def current_user(handler: BaseHTTPRequestHandler) -> dict | None:
    token = session_cookie.parse_cookie_header(handler.headers.get("Cookie"))
    return session_cookie.verify_session(token)


def resolve_static(path: str) -> Path | None:
    if not STATIC_ROOT.is_dir():
        return None
    relative = path.lstrip("/") or "index.html"
    candidate = (STATIC_ROOT / relative).resolve()
    try:
        candidate.relative_to(STATIC_ROOT.resolve())
    except ValueError:
        return None
    if candidate.is_file():
        return candidate
    # SPA fallback for client routes.
    index = STATIC_ROOT / "index.html"
    return index if index.is_file() else None


class Handler(BaseHTTPRequestHandler):
    server_version = "RobomapPayments/1.1"
    protocol_version = "HTTP/1.1"

    def do_GET(self) -> None:  # noqa: N802
        self._dispatch(include_body=True)

    def do_HEAD(self) -> None:  # noqa: N802
        self._dispatch(include_body=False)

    def do_POST(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path == "/api/auth/session":
            self._post_session()
            return
        if path == "/api/auth/logout":
            self._post_logout()
            return
        self._send(405, "text/plain; charset=utf-8", b"Method not allowed\n", include_body=True)

    def do_OPTIONS(self) -> None:  # noqa: N802
        # Same-origin SPA; keep OPTIONS simple for local tooling.
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _dispatch(self, include_body: bool) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        if path in ("/health", "/healthz", "/ready"):
            self._send(200, "application/json", _json_bytes(health_payload()), include_body)
            return

        if path == "/api/auth/me":
            user = current_user(self)
            if not user:
                self._send(401, "application/json", _json_bytes({"authenticated": False}), include_body)
                return
            self._send(200, "application/json", _json_bytes({"authenticated": True, "user": user}), include_body)
            return

        if path == "/auth/sso/start":
            return_url = (query.get("returnUrl") or query.get("return_url") or [None])[0]
            location = sso.build_handoff_url(return_url)
            self._redirect(location, include_body)
            return

        if path.startswith("/auth/oauth/"):
            provider = path.rsplit("/", 1)[-1]
            if provider not in ("google", "apple"):
                self._send(404, "text/plain; charset=utf-8", b"Not found\n", include_body)
                return
            return_url = (query.get("returnUrl") or [None])[0]
            self._redirect(sso.build_oauth_url(provider, return_url), include_body)
            return

        # Static SPA (and SPA deep links).
        static_file = resolve_static(path)
        if static_file is not None:
            data = static_file.read_bytes()
            content_type = mimetypes.guess_type(str(static_file))[0] or "application/octet-stream"
            if static_file.name == "index.html":
                content_type = "text/html; charset=utf-8"
            self._send(200, content_type, data, include_body)
            return

        # Fallback HTML when the SPA has not been built yet (container health / early boot).
        if path == "/":
            self._send(200, "text/html; charset=utf-8", self._fallback_home(), include_body)
            return

        self._send(404, "text/plain; charset=utf-8", b"Not found\n", include_body)

    def _post_session(self) -> None:
        body = _read_json_body(self)
        if not body:
            self._send(400, "application/json", _json_bytes({"error": "invalid_json"}), True)
            return
        access_token = body.get("access_token") or body.get("accessToken")
        if not isinstance(access_token, str) or not access_token.strip():
            self._send(400, "application/json", _json_bytes({"error": "missing_access_token"}), True)
            return
        return_url = sso.sanitize_return_url(body.get("returnUrl") or body.get("return_url"))
        user = sso.fetch_user_for_access_token(access_token)
        if not user:
            self._send(401, "application/json", _json_bytes({"error": "invalid_token"}), True)
            return
        token = session_cookie.issue_session(user)
        secure = os.environ.get("COOKIE_SECURE", "1") != "0"
        self._send(
            200,
            "application/json",
            _json_bytes({"ok": True, "user": user, "returnUrl": return_url}),
            True,
            extra_headers=[("Set-Cookie", session_cookie.set_cookie_header(token, secure=secure))],
        )

    def _post_logout(self) -> None:
        secure = os.environ.get("COOKIE_SECURE", "1") != "0"
        self._send(
            200,
            "application/json",
            _json_bytes({"ok": True}),
            True,
            extra_headers=[("Set-Cookie", session_cookie.clear_cookie_header(secure=secure))],
        )

    def _fallback_home(self) -> bytes:
        host = site_host()
        page = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Payments | Robomap</title>
  <link rel="canonical" href="https://{host}/">
</head>
<body>
  <main>
    <h1>Robomap Payments</h1>
    <p>Build the web app (<code>web/dist</code>) or open the Static Web App deploy.</p>
    <p><a href="/auth/sso/start?returnUrl=/app">Continue with Robomap SSO</a></p>
    <p><a href="/health">Health</a></p>
  </main>
</body>
</html>
"""
        return page.encode("utf-8")

    def _redirect(self, location: str, include_body: bool) -> None:
        body = b""
        self.send_response(302)
        self.send_header("Location", location)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", "0")
        self.end_headers()
        if include_body:
            self.wfile.write(body)

    def _send(
        self,
        status: int,
        content_type: str,
        body: bytes,
        include_body: bool,
        extra_headers: list[tuple[str, str]] | None = None,
    ) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body) if include_body else 0))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        if content_type.startswith("text/html"):
            self.send_header(
                "Content-Security-Policy",
                "default-src 'self'; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
                "font-src 'self' https://cdn.jsdelivr.net; img-src 'self' data:; "
                "connect-src 'self'; frame-ancestors 'none'",
            )
        for key, value in extra_headers or []:
            self.send_header(key, value)
        self.end_headers()
        if include_body:
            self.wfile.write(body)

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"{self.address_string()} {fmt % args}")


def make_server(port: int | None = None) -> ThreadingHTTPServer:
    return ThreadingHTTPServer(("0.0.0.0", listen_port() if port is None else port), Handler)


def main() -> None:
    server = make_server()
    print(f"listening on 0.0.0.0:{server.server_address[1]}")
    print(f"static root: {STATIC_ROOT} exists={STATIC_ROOT.is_dir()}")
    server.serve_forever()


if __name__ == "__main__":
    main()
