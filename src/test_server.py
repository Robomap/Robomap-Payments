import json
import os
import sys
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import server


class PaymentsServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        os.environ["SITE_HOST"] = "payments.robomap.ai"
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

    def fetch(self, path: str, method: str = "GET") -> tuple[int, str, str]:
        request = urllib.request.Request(self.url(path), method=method)
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                body = response.read().decode("utf-8")
                return response.status, response.headers.get("Content-Type", ""), body
        except urllib.error.HTTPError as error:
            return error.code, error.headers.get("Content-Type", ""), error.read().decode("utf-8")

    def test_home_identifies_the_payments_host(self) -> None:
        status, content_type, body = self.fetch("/")
        self.assertEqual(status, 200)
        self.assertIn("text/html", content_type)
        self.assertIn("Robomap payments is up.", body)
        self.assertIn("https://robomap.ai/", body)
        self.assertIn("payments.robomap.ai", body)
        lowered = body.lower()
        self.assertNotIn("<form", lowered)
        self.assertNotIn("<input", lowered)
        self.assertIn("does not collect card numbers", lowered)

    def test_health(self) -> None:
        status, content_type, body = self.fetch("/health")
        self.assertEqual(status, 200)
        self.assertIn("application/json", content_type)
        self.assertEqual(
            json.loads(body),
            {"status": "ok", "service": "robomap-payments", "host": "payments.robomap.ai"},
        )

    def test_unknown_path_and_post(self) -> None:
        status, _, _ = self.fetch("/missing")
        self.assertEqual(status, 404)
        status, _, body = self.fetch("/", method="POST")
        self.assertEqual(status, 405)
        self.assertIn("Method not allowed", body)


if __name__ == "__main__":
    unittest.main()
