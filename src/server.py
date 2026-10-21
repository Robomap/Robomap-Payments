"""Robomap Payments HTTP host.

The process binds to 0.0.0.0 and PORT (default 8080) so it can run in Azure
Container Apps. It does not collect card data.
"""

from __future__ import annotations

import html
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SERVICE = "robomap-payments"
DEFAULT_SITE_HOST = "payments.robomap.ai"


def site_host() -> str:
    return os.environ.get("SITE_HOST", DEFAULT_SITE_HOST)


def listen_port() -> int:
    return int(os.environ.get("PORT", "8080"))


def health_payload() -> dict[str, str]:
    return {"status": "ok", "service": SERVICE, "host": site_host()}


def render_page() -> bytes:
    host = html.escape(site_host(), quote=True)
    page = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Payments | Robomap</title>
  <meta name="description" content="Robomap payments host for robomap.ai.">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="https://{host}/">
  <style>
    :root {{
      color-scheme: light;
      --page: #ffffff;
      --ink: #000000;
      --muted: #6b6b6b;
      --line: rgba(0, 0, 0, 0.14);
      --surface: #f6f6f6;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      min-height: 100vh;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 17px;
      line-height: 1.47;
      letter-spacing: -0.022em;
      color: var(--ink);
      background: var(--page);
    }}
    header, main {{
      width: min(calc(100% - 48px), 720px);
      margin: 0 auto;
    }}
    header {{
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 72px;
    }}
    a {{ color: inherit; }}
    .wordmark {{ font-weight: 650; letter-spacing: -0.04em; text-decoration: none; }}
    main {{ padding: 48px 0 72px; }}
    h1 {{
      margin: 0 0 12px;
      font-size: clamp(40px, 6vw, 64px);
      line-height: 1.05;
      letter-spacing: -0.045em;
      font-weight: 650;
    }}
    p {{ margin: 0 0 16px; max-width: 38rem; }}
    .muted {{ color: var(--muted); }}
    .status {{
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin: 8px 0 28px;
      padding: 8px 12px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: var(--surface);
      font-size: 14px;
    }}
    .dot {{
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #0a7a32;
    }}
    .actions {{ display: flex; gap: 12px; flex-wrap: wrap; margin-top: 28px; }}
    .button {{
      display: inline-flex;
      align-items: center;
      min-height: 44px;
      padding: 0 18px;
      border-radius: 999px;
      background: #000;
      color: #fff;
      text-decoration: none;
    }}
    .button.secondary {{
      background: #fff;
      color: #000;
      border: 1px solid var(--line);
    }}
  </style>
</head>
<body>
  <header>
    <a class="wordmark" href="https://robomap.ai/">Robomap</a>
    <a href="https://robomap.ai/">robomap.ai</a>
  </header>
  <main>
    <p class="muted">Payments</p>
    <h1>Robomap payments is up.</h1>
    <div class="status"><span class="dot" aria-hidden="true"></span> Service healthy at {host}</div>
    <p>This host is the payments endpoint for Robomap, the on-demand industrial and technical services marketplace.</p>
    <p class="muted">Book a technician on the main site. This page does not collect card numbers.</p>
    <div class="actions">
      <a class="button" href="https://robomap.ai/">Go to Robomap</a>
      <a class="button secondary" href="/health">Health</a>
    </div>
  </main>
</body>
</html>
"""
    return page.encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    server_version = "RobomapPayments/1.0"
    protocol_version = "HTTP/1.1"

    def do_GET(self) -> None:  # noqa: N802
        self._respond(include_body=True)

    def do_HEAD(self) -> None:  # noqa: N802
        self._respond(include_body=False)

    def do_POST(self) -> None:  # noqa: N802
        self._send(405, "text/plain; charset=utf-8", b"Method not allowed\n", include_body=True)

    def _respond(self, include_body: bool) -> None:
        path = self.path.split("?", 1)[0]
        if path in ("/health", "/healthz", "/ready"):
            body = json.dumps(health_payload()).encode("utf-8")
            self._send(200, "application/json", body, include_body)
            return
        if path == "/":
            self._send(200, "text/html; charset=utf-8", render_page(), include_body)
            return
        self._send(404, "text/plain; charset=utf-8", b"Not found\n", include_body)

    def _send(self, status: int, content_type: str, body: bytes, include_body: bool) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body) if include_body else 0))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'unsafe-inline'")
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
    server.serve_forever()


if __name__ == "__main__":
    main()
