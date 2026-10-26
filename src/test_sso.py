import os
import unittest
from unittest import mock

import session_cookie
import sso


class SsoHelpersTest(unittest.TestCase):
    def test_sanitize_return_url_allowlist(self) -> None:
        self.assertEqual(sso.sanitize_return_url("/app/send"), "/app/send")
        self.assertEqual(sso.sanitize_return_url("/"), "/app")
        self.assertEqual(sso.sanitize_return_url("//evil.example"), "/app")
        self.assertEqual(sso.sanitize_return_url("/auth/login"), "/app")
        self.assertEqual(sso.sanitize_return_url("https://evil.example/"), "/app")
        self.assertEqual(sso.sanitize_return_url("/app\n/x"), "/app")

    def test_build_handoff_url(self) -> None:
        os.environ["ROBOMAP_API_ORIGIN"] = "https://api.robomap.ai"
        os.environ["ROBOMAP_SSO_APP"] = "payments"
        url = sso.build_handoff_url("/app")
        self.assertTrue(url.startswith("https://api.robomap.ai/auth/sso/handoff?"))
        self.assertIn("app=payments", url)
        self.assertIn("returnUrl=%2Fapp", url)

    def test_allowed_absolute_hosts(self) -> None:
        self.assertTrue(sso.is_allowed_robomap_absolute_url("https://payments.robomap.ai/login"))
        self.assertTrue(sso.is_allowed_robomap_absolute_url("https://app.robomap.ai/auth/login"))
        self.assertFalse(sso.is_allowed_robomap_absolute_url("https://evil.com/"))
        self.assertFalse(sso.is_allowed_robomap_absolute_url("http://payments.robomap.ai/"))

    def test_normalize_user(self) -> None:
        user = sso.normalize_user(
            {"id": 42, "email": "ada@robomap.ai", "name": "Ada Lovelace", "username": "ada"}
        )
        self.assertEqual(
            user,
            {
                "id": "42",
                "email": "ada@robomap.ai",
                "name": "Ada Lovelace",
                "tag": "@ada",
            },
        )
        self.assertIsNone(sso.normalize_user({"name": "No Email"}))

    def test_fetch_user_for_access_token_uses_bearer(self) -> None:
        payload = {"id": "u1", "email": "ada@robomap.ai", "name": "Ada"}

        def fake_get(url: str, headers: dict[str, str], timeout: float = 8.0):
            self.assertIn("Authorization", headers)
            self.assertTrue(headers["Authorization"].startswith("Bearer "))
            if url.endswith("/auth/me"):
                return 200, payload
            return 404, None

        with mock.patch.object(sso, "_http_get_json", side_effect=fake_get):
            user = sso.fetch_user_for_access_token("test-token")
        self.assertEqual(user["email"], "ada@robomap.ai")

    def test_rejects_garbage_tokens(self) -> None:
        self.assertIsNone(sso.fetch_user_for_access_token(""))
        self.assertIsNone(sso.fetch_user_for_access_token("https://evil.example/x"))
        self.assertIsNone(sso.fetch_user_for_access_token("has space"))


class SessionCookieTest(unittest.TestCase):
    def setUp(self) -> None:
        os.environ["PAYMENTS_SESSION_SECRET"] = "unit-test-secret"

    def test_round_trip(self) -> None:
        token = session_cookie.issue_session(
            {"id": "1", "email": "ada@robomap.ai", "name": "Ada", "tag": "@ada"}
        )
        user = session_cookie.verify_session(token)
        self.assertIsNotNone(user)
        assert user is not None
        self.assertEqual(user["email"], "ada@robomap.ai")
        self.assertEqual(user["name"], "Ada")

    def test_tamper_fails(self) -> None:
        token = session_cookie.issue_session({"id": "1", "email": "ada@robomap.ai", "name": "Ada"})
        body, sig = token.split(".", 1)
        self.assertIsNone(session_cookie.verify_session(f"{body}.{sig[:-1]}x"))

    def test_parse_cookie_header(self) -> None:
        header = "a=1; robomap_payments_session=abc.def; b=2"
        self.assertEqual(session_cookie.parse_cookie_header(header), "abc.def")


if __name__ == "__main__":
    unittest.main()
