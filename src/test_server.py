import json
import os
import sys
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import server
import session_cookie
import sso


class PaymentsServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        os.environ["SITE_HOST"] = "payments.robomap.ai"
        os.environ["PAYMENTS_SESSION_SECRET"] = "unit-test-secret"
        os.environ["COOKIE_SECURE"] = "0"
        os.environ["ROBOMAP_API_ORIGIN"] = "https://api.robomap.ai"
        os.environ["ROBOMAP_SSO_APP"] = "payments"
        cls.httpd = server.make_server(0)
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.httpd.shutdown()
        cls.thread.join(timeout=5)

    def url(self, path: str) -> str:
        return f"http://127.0.0.1:{self.port}{path}"

    def fetch(
        self,
        path: str,
        method: str = "GET",
        data: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> tuple[int, dict[str, str], str]:
        request = urllib.request.Request(self.url(path), data=data, method=method)
        for key, value in (headers or {}).items():
            request.add_header(key, value)
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                body = response.read().decode("utf-8")
                return response.status, dict(response.headers.items()), body
        except urllib.error.HTTPError as error:
            return error.code, dict(error.headers.items()), error.read().decode("utf-8")

    def test_health(self) -> None:
        status, headers, body = self.fetch("/health")
        self.assertEqual(status, 200)
        self.assertIn("application/json", headers.get("Content-Type", ""))
        self.assertEqual(
            json.loads(body),
            {"status": "ok", "service": "robomap-payments", "host": "payments.robomap.ai"},
        )

    def test_sso_start_redirects_to_api_handoff(self) -> None:
        # urllib follows redirects by default; use a no-redirect opener.
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
                return None

        opener = urllib.request.build_opener(NoRedirect)
        try:
            opener.open(self.url("/auth/sso/start?returnUrl=%2Fapp"), timeout=5)
            self.fail("expected redirect")
        except urllib.error.HTTPError as error:
            self.assertEqual(error.code, 302)
            location = error.headers.get("Location", "")
            self.assertTrue(location.startswith("https://api.robomap.ai/auth/sso/handoff?"))
            self.assertIn("app=payments", location)
            self.assertIn("returnUrl=%2Fapp", location)

    def test_me_unauthenticated(self) -> None:
        status, _, body = self.fetch("/api/auth/me")
        self.assertEqual(status, 401)
        self.assertEqual(json.loads(body), {"authenticated": False})

    def test_session_exchange_sets_cookie(self) -> None:
        fake_user = {"id": "u1", "email": "ada@robomap.ai", "name": "Ada", "tag": "@ada"}

        with mock.patch.object(sso, "fetch_user_for_access_token", return_value=fake_user):
            status, headers, body = self.fetch(
                "/api/auth/session",
                method="POST",
                data=json.dumps({"access_token": "good-token", "returnUrl": "/app"}).encode(),
                headers={"Content-Type": "application/json"},
            )
        self.assertEqual(status, 200)
        payload = json.loads(body)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["user"]["email"], "ada@robomap.ai")
        set_cookie = headers.get("Set-Cookie", "")
        self.assertIn(session_cookie.COOKIE_NAME, set_cookie)

        # Cookie should authenticate /api/auth/me
        cookie_value = set_cookie.split(";", 1)[0]
        status, _, body = self.fetch("/api/auth/me", headers={"Cookie": cookie_value})
        self.assertEqual(status, 200)
        me = json.loads(body)
        self.assertTrue(me["authenticated"])
        self.assertEqual(me["user"]["email"], "ada@robomap.ai")

    def test_session_rejects_invalid_token(self) -> None:
        with mock.patch.object(sso, "fetch_user_for_access_token", return_value=None):
            status, _, body = self.fetch(
                "/api/auth/session",
                method="POST",
                data=json.dumps({"access_token": "bad"}).encode(),
                headers={"Content-Type": "application/json"},
            )
        self.assertEqual(status, 401)
        self.assertEqual(json.loads(body)["error"], "invalid_token")

    def test_logout_clears_cookie(self) -> None:
        status, headers, body = self.fetch("/api/auth/logout", method="POST")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {"ok": True})
        self.assertIn(f"{session_cookie.COOKIE_NAME}=", headers.get("Set-Cookie", ""))
        self.assertIn("Max-Age=0", headers.get("Set-Cookie", ""))

    def test_unknown_path_and_post(self) -> None:
        # With a built SPA, client routes fall back to index.html (200).
        # Without STATIC_ROOT / dist, the same path would 404.
        status, headers, body = self.fetch("/missing-no-spa")
        if server.STATIC_ROOT.is_dir() and (server.STATIC_ROOT / "index.html").is_file():
            self.assertEqual(status, 200)
            self.assertIn("text/html", headers.get("Content-Type", ""))
            self.assertIn("<!doctype html>", body.lower())
        else:
            self.assertEqual(status, 404)
        status, _, body = self.fetch("/", method="POST")
        self.assertEqual(status, 405)
        self.assertIn("Method not allowed", body)


if __name__ == "__main__":
    unittest.main()
