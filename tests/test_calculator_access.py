import copy
import ast
from pathlib import Path
import sys
from types import ModuleType
import unittest
from unittest.mock import Mock, patch

from flask import Flask

from calculator_access import (
    APP_IDS, CALCULATOR_PATHS, AccessError, AccessManager, FirebaseBackend,
    email_key, install_calculator_access,
)


class FakeFirebase:
    def __init__(self):
        self.tokens = {
            "owner": {"uid": "owner", "email": "owner@example.com", "email_verified": True},
            "member": {"uid": "member", "email": "member@example.com", "email_verified": True},
            "glass": {"uid": "glass", "email": "glass@example.com", "email_verified": True},
            "unverified": {"uid": "member", "email": "member@example.com", "email_verified": False},
        }
        self.entries = {
            "member@example.com": {"email": "member@example.com", "active": True, "apps": {"complete": True, "profiles": True, "wind": True, "glass": False}},
            "glass@example.com": {"email": "glass@example.com", "active": True, "apps": {"glass": True}},
        }
        self.reads = 0
        self.fail = False

    def verify_token(self, token):
        if token not in self.tokens:
            raise AccessError(401, "invalid_token", "Invalid, expired or revoked token")
        return self.tokens[token]

    def get_entry(self, email):
        self.reads += 1
        if self.fail:
            raise RuntimeError("Firestore unavailable")
        return self.entries.get(email)

    def list_entries(self):
        return [{"id": email_key(email), **copy.deepcopy(entry)} for email, entry in self.entries.items()]

    def put_entry(self, email, entry, actor_uid):
        self.entries[email] = {"email": email, **copy.deepcopy(entry), "actor": actor_uid}

    def delete_entry(self, key):
        self.entries = {email: entry for email, entry in self.entries.items() if email_key(email) != key}


class CalculatorAccessTests(unittest.TestCase):
    def setUp(self):
        self.backend = FakeFirebase()
        self.app = Flask(__name__)
        self.executed = []
        manager = AccessManager(self.backend, admin_emails=["owner@example.com"], web_config={
            "apiKey": "public-api-key", "authDomain": "example.firebaseapp.com", "projectId": "example", "appId": "example-app",
            "private_key": "must-not-be-exposed",
        })
        install_calculator_access(self.app, manager)
        for index, path in enumerate(CALCULATOR_PATHS):
            self.app.add_url_rule(path, f"calculator_{index}", self.calculate, methods=["POST"])
        self.app.add_url_rule("/spotify/public-test", "spotify_test", lambda: "Spotify unaffected")
        self.client = self.app.test_client()

    def calculate(self):
        self.executed.append(True)
        return {"pressao_ensaio": 1350}

    def headers(self, token="member", app="profiles"):
        return {"Authorization": f"Bearer {token}", "X-Calculator-App": app}

    def test_every_calculation_endpoint_requires_identity(self):
        for path in CALCULATOR_PATHS:
            with self.subTest(path=path):
                response = self.client.post(path, json={})
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.json["code"], "login_required")
        self.assertEqual(self.executed, [])

    def test_production_calculation_routes_are_covered(self):
        source = ast.parse((Path(__file__).resolve().parents[1] / 'app.py').read_text(encoding='utf-8'))
        paths = set()
        for function in source.body:
            if not isinstance(function, ast.FunctionDef):
                continue
            for decorator in function.decorator_list:
                if not isinstance(decorator, ast.Call) or not isinstance(decorator.func, ast.Attribute) or decorator.func.attr != 'route':
                    continue
                methods = next((keyword.value for keyword in decorator.keywords if keyword.arg == 'methods'), None)
                if isinstance(methods, ast.List) and any(isinstance(method, ast.Constant) and method.value == 'POST' for method in methods.elts):
                    paths.add(ast.literal_eval(decorator.args[0]))
        self.assertEqual(paths, CALCULATOR_PATHS)

    def test_firebase_sdk_checks_revocation_in_project_app(self):
        sdk = ModuleType('firebase_admin')
        sdk.auth = ModuleType('firebase_admin.auth')
        sdk.auth.verify_id_token = Mock(return_value={'uid': 'verified'})
        backend = FirebaseBackend('expected-project')
        backend.app = object()
        with patch.dict(sys.modules, {'firebase_admin': sdk, 'firebase_admin.auth': sdk.auth}):
            self.assertEqual(backend.verify_token('signed-id-token'), {'uid': 'verified'})
        sdk.auth.verify_id_token.assert_called_once_with('signed-id-token', app=backend.app, check_revoked=True)

    def test_spotify_paths_and_preflight_are_not_protected(self):
        self.assertEqual(self.client.get("/spotify/public-test").status_code, 200)
        self.assertEqual(self.client.options("/pressaovento").status_code, 200)
        self.assertEqual(self.executed, [])

    def test_invalid_tokens_cannot_reach_calculation(self):
        for token in ("forged", "expired", "revoked", "disabled"):
            with self.subTest(token=token):
                self.assertEqual(self.client.post("/pressaovento", headers=self.headers(token), json={}).status_code, 401)
        self.assertEqual(self.executed, [])

    def test_unverified_email_and_missing_uid_are_denied(self):
        self.assertEqual(self.client.get("/auth/me", headers=self.headers("unverified")).status_code, 403)
        self.backend.tokens["bad"] = {"email": "owner@example.com", "email_verified": True}
        self.assertEqual(self.client.get("/auth/me", headers=self.headers("bad")).status_code, 403)

    def test_client_email_and_admin_headers_cannot_change_identity(self):
        headers = {**self.headers(), "X-User-Email": "owner@example.com", "X-Admin": "true"}
        response = self.client.get("/auth/me", headers=headers)
        self.assertEqual(response.json["email"], "member@example.com")
        self.assertFalse(response.json["admin"])
        self.assertEqual(self.client.get("/auth/access", headers=headers).status_code, 403)

    def test_unknown_inactive_and_empty_grants_are_denied(self):
        for entry in (None, {"email": "member@example.com", "active": False, "apps": {"profiles": True}}, {"email": "member@example.com", "active": True, "apps": {}}):
            with self.subTest(entry=entry):
                self.backend.entries["member@example.com"] = entry
                self.assertEqual(self.client.get("/auth/me", headers=self.headers()).status_code, 403)

    def test_only_literal_true_grants_permission(self):
        self.backend.entries["member@example.com"]["apps"] = {"profiles": "true", "glass": 1}
        self.assertEqual(self.client.get("/auth/me", headers=self.headers()).status_code, 403)

    def test_missing_or_ungranted_app_is_denied(self):
        for app in ("", "unknown", "glass"):
            self.assertEqual(self.client.post("/pressaovento", headers=self.headers(app=app), json={}).status_code, 403)
        self.assertEqual(self.executed, [])

    def test_glass_cannot_be_requested_through_other_apps(self):
        payloads = [{"calcular_vidro": True}, {"calcular_vidro": "true"}, {"tipo_vidro": "laminado_float_2"}, {"largura_vidro": 1000}, {"altura_vidro": 2000}]
        for app in ("profiles", "wind", "complete"):
            for payload in payloads:
                with self.subTest(app=app, payload=payload):
                    self.assertEqual(self.client.post("/pressaovento", headers=self.headers(app=app), json=payload).status_code, 403)
        self.assertEqual(self.executed, [])

    def test_glass_permission_does_not_grant_profiles(self):
        for field in ("larguratotal", "alturafol", "quantidadefol", "liga"):
            self.assertEqual(self.client.post("/pressaovento", headers=self.headers("glass", "glass"), json={field: "1"}).status_code, 403)
        self.assertEqual(self.executed, [])

    def test_valid_requests_are_allowed_with_each_scope(self):
        self.assertEqual(self.client.post("/pressaovento", headers=self.headers(), json={"larguratotal": 1000, "alturafol": 2000, "quantidadefol": 1}).status_code, 200)
        self.assertEqual(self.client.post("/pressaovento", headers=self.headers("glass", "glass"), json={"calcular_vidro": True, "largura_vidro": 1000, "altura_vidro": 2000}).status_code, 200)
        self.assertEqual(self.client.post("/nbr6123/s2", headers=self.headers("glass", "glass"), json={"categoria": "categoria1", "altura": 20}).status_code, 200)

    def test_full_calculation_requires_glass_grant_for_glass_output(self):
        self.backend.entries["member@example.com"]["apps"]["glass"] = True
        self.assertEqual(self.client.post("/pressaovento", headers=self.headers(app="complete"), json={"calcular_vidro": True}).status_code, 200)
        self.backend.entries["member@example.com"]["apps"]["glass"] = False
        self.assertEqual(self.client.post("/pressaovento", headers=self.headers(app="complete"), json={"calcular_vidro": True}).status_code, 403)

    def test_permissions_are_reread_on_every_request(self):
        self.assertEqual(self.client.post("/pressaovento", headers=self.headers(), json={}).status_code, 200)
        self.backend.entries["member@example.com"]["active"] = False
        self.assertEqual(self.client.post("/pressaovento", headers=self.headers(), json={}).status_code, 403)
        self.assertEqual(self.backend.reads, 2)

    def test_firestore_failure_is_fail_closed(self):
        self.backend.fail = True
        self.assertEqual(self.client.post("/pressaovento", headers=self.headers(), json={}).status_code, 503)
        self.assertEqual(self.executed, [])

    def test_unconfigured_firebase_is_fail_closed(self):
        self.app.extensions["calculator_access"].backend = FirebaseBackend("")
        self.assertEqual(self.client.post("/pressaovento", headers=self.headers(), json={}).status_code, 503)
        self.assertEqual(self.executed, [])

    def test_non_object_json_is_rejected(self):
        self.assertEqual(self.client.post("/pressaovento", headers=self.headers(), json=[]).status_code, 400)
        self.assertEqual(self.executed, [])

    def test_admin_can_manage_grants_but_members_cannot(self):
        payload = {"email": " New@Example.com ", "active": True, "apps": {"glass": True}}
        self.assertEqual(self.client.put("/auth/access", headers=self.headers(), json=payload).status_code, 403)
        response = self.client.put("/auth/access", headers=self.headers("owner"), json=payload)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["email"], "new@example.com")
        self.assertEqual(self.backend.entries["new@example.com"]["actor"], "owner")
        self.assertFalse(response.json["apps"]["profiles"])
        self.assertEqual(self.client.get("/auth/access", headers=self.headers("owner")).status_code, 200)
        key = email_key("new@example.com")
        self.assertEqual(self.client.delete(f"/auth/access/{key}", headers=self.headers()).status_code, 403)
        self.assertEqual(self.client.delete(f"/auth/access/{key}", headers=self.headers("owner")).status_code, 200)

    def test_admin_role_cannot_be_created_via_grant_payload(self):
        for apps in ({"glass": "true"}, {"admin": True}):
            self.assertEqual(self.client.put("/auth/access", headers=self.headers("owner"), json={"email": "new@example.com", "active": True, "apps": apps}).status_code, 400)
        self.assertEqual(self.client.put("/auth/access", headers=self.headers("owner"), json={"email": "new@example.com", "active": True, "apps": {}, "admin": True}).status_code, 400)

    def test_public_configuration_never_includes_private_fields(self):
        response = self.client.get("/auth/config")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("private_key", response.json["firebase"])
        self.assertEqual(set(response.json["firebase"]), {"apiKey", "authDomain", "projectId", "appId"})

    def test_private_responses_are_not_cacheable(self):
        response = self.client.get("/auth/me", headers=self.headers())
        self.assertEqual(response.headers["Cache-Control"], "private, no-store")
        self.assertIn("Authorization", response.headers["Vary"])


if __name__ == "__main__":
    unittest.main()
