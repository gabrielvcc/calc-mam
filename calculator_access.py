"""Firebase identity and server-side authorization for the calculators."""

import hashlib
import json
import logging
import os
import re
import threading

from flask import g, jsonify, request


APP_IDS = frozenset({"complete", "profiles", "glass", "wind"})
CALCULATOR_PATHS = frozenset({"/pressaovento", "/regiaovento", "/nbr6123/s2", "/nbr6123/calcular"})
FRAME_FIELDS = frozenset({"larguratotal", "quantidadefol", "alturafol", "liga"})
GLASS_FIELDS = frozenset({"tipo_vidro", "largura_vidro", "altura_vidro"})
logger = logging.getLogger(__name__)


class AccessError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status = status
        self.code = code


def normalize_email(value):
    if not isinstance(value, str) or len(value) > 254:
        raise ValueError("Informe um e-mail válido.")
    value = value.strip().lower()
    if not re.fullmatch(r"[^\s@\x00-\x1f]+@[^\s@\x00-\x1f]+\.[^\s@\x00-\x1f]+", value):
        raise ValueError("Informe um e-mail válido.")
    return value


def email_key(email):
    return hashlib.sha256(normalize_email(email).encode("utf-8")).hexdigest()


class FirebaseBackend:
    def __init__(self, project_id):
        self.project_id = project_id
        self.app = None
        self.db = None
        self.lock = threading.Lock()

    def _initialize(self):
        if self.app is not None:
            return
        with self.lock:
            if self.app is not None:
                return
            if not self.project_id or os.getenv("FIREBASE_AUTH_EMULATOR_HOST") or os.getenv("FIRESTORE_EMULATOR_HOST"):
                raise AccessError(503, "auth_unavailable", "O controle de acesso está indisponível.")
            try:
                import firebase_admin
                from firebase_admin import credentials, firestore

                raw_credentials = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON")
                if raw_credentials:
                    account = json.loads(raw_credentials)
                    if account.get("project_id") != self.project_id:
                        raise ValueError("Firebase credential project mismatch")
                    credential = credentials.Certificate(account)
                else:
                    credential = credentials.ApplicationDefault()
                try:
                    app = firebase_admin.get_app("calculator-access")
                except ValueError:
                    app = firebase_admin.initialize_app(credential, {"projectId": self.project_id}, name="calculator-access")
                if app.project_id != self.project_id:
                    raise ValueError("Firebase project mismatch")
                self.db = firestore.client(app=app)
                self.app = app
            except AccessError:
                raise
            except Exception:
                logger.error("Calculator Firebase initialization failed; access denied")
                raise AccessError(503, "auth_unavailable", "O controle de acesso está indisponível.") from None

    def verify_token(self, token):
        self._initialize()
        from firebase_admin import auth

        try:
            return auth.verify_id_token(token, app=self.app, check_revoked=True)
        except auth.CertificateFetchError:
            raise AccessError(503, "auth_unavailable", "Não foi possível verificar o login agora.") from None
        except (auth.InvalidIdTokenError, auth.UserDisabledError, auth.UserNotFoundError, ValueError):
            raise AccessError(401, "invalid_token", "Seu login expirou ou foi revogado. Entre novamente.") from None
        except Exception:
            logger.error("Calculator Firebase token verification unavailable")
            raise AccessError(503, "auth_unavailable", "Não foi possível verificar o login agora.") from None

    def get_entry(self, email):
        self._initialize()
        snapshot = self.db.collection("calculator_access").document(email_key(email)).get(timeout=10)
        return snapshot.to_dict() if snapshot.exists else None

    def list_entries(self):
        self._initialize()
        entries = self.db.collection("calculator_access").order_by("email").limit(500).stream(timeout=10)
        return [{"id": item.id, **item.to_dict()} for item in entries]

    def put_entry(self, email, entry, actor_uid):
        self._initialize()
        from firebase_admin import firestore

        self.db.collection("calculator_access").document(email_key(email)).set({
            "email": email, **entry, "updated_by": actor_uid, "updated_at": firestore.SERVER_TIMESTAMP,
        }, timeout=10)

    def delete_entry(self, key):
        self._initialize()
        self.db.collection("calculator_access").document(key).delete(timeout=10)


class AccessManager:
    def __init__(self, backend, admin_emails=(), web_config=None, contact_email="eng@gabrielvc.com.br"):
        self.backend = backend
        self.admin_emails = frozenset(normalize_email(email) for email in admin_emails if email.strip())
        self.web_config = web_config or {}
        self.contact_email = contact_email

    @classmethod
    def from_environment(cls):
        project = os.getenv("FIREBASE_PROJECT_ID", "").strip()
        return cls(
            FirebaseBackend(project),
            admin_emails=os.getenv("CALCULATOR_ADMIN_EMAILS", "").split(","),
            web_config={
                "apiKey": os.getenv("FIREBASE_WEB_API_KEY", "").strip(),
                "authDomain": os.getenv("FIREBASE_WEB_AUTH_DOMAIN", "").strip(),
                "projectId": project,
                "appId": os.getenv("FIREBASE_WEB_APP_ID", "").strip(),
            },
            contact_email=os.getenv("CALCULATOR_CONTACT_EMAIL", "eng@gabrielvc.com.br"),
        )

    def authenticate(self):
        authorization = request.headers.get("Authorization", "").split()
        if len(authorization) != 2 or authorization[0].lower() != "bearer" or len(authorization[1]) > 16384:
            raise AccessError(401, "login_required", "Entre na sua conta para continuar.")
        claims = self.backend.verify_token(authorization[1])
        if claims.get("email_verified") is not True or not claims.get("uid", claims.get("sub")):
            raise AccessError(403, "email_unverified", "Use uma conta com e-mail verificado.")
        try:
            email = normalize_email(claims.get("email"))
        except ValueError:
            raise AccessError(403, "email_unverified", "Use uma conta com e-mail verificado.") from None
        admin = email in self.admin_emails
        if admin:
            apps = {app: True for app in APP_IDS}
        else:
            try:
                entry = self.backend.get_entry(email)
            except AccessError:
                raise
            except Exception:
                logger.error("Calculator whitelist lookup failed; access denied")
                raise AccessError(503, "access_unavailable", "Não foi possível conferir suas permissões agora.") from None
            if not isinstance(entry, dict) or entry.get("active") is not True or entry.get("email") != email:
                raise AccessError(403, "not_allowlisted", "Seu e-mail não está autorizado a usar as calculadoras.")
            permissions = entry.get("apps", {})
            apps = {app: isinstance(permissions, dict) and permissions.get(app) is True for app in APP_IDS}
            if not any(apps.values()):
                raise AccessError(403, "not_allowlisted", "Seu e-mail não tem calculadoras liberadas.")
        principal = {
            "uid": claims.get("uid", claims.get("sub")), "email": email,
            "name": str(claims.get("name", ""))[:200], "admin": admin, "apps": apps,
        }
        g.calculator_user = principal
        return principal

    def require_admin(self):
        principal = self.authenticate()
        if not principal["admin"]:
            raise AccessError(403, "admin_required", "Acesso restrito ao administrador.")
        return principal

    def authorize_calculation(self):
        principal = self.authenticate()
        app_id = request.headers.get("X-Calculator-App")
        if app_id not in APP_IDS or not principal["apps"][app_id]:
            raise AccessError(403, "app_forbidden", "Você não tem permissão para esta calculadora.")
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            raise AccessError(400, "invalid_payload", "Envie um objeto JSON válido.")
        has_frame = bool(FRAME_FIELDS.intersection(payload))
        has_glass = payload.get("calcular_vidro") not in (None, False) or bool(GLASS_FIELDS.intersection(payload))
        if has_frame and app_id not in {"profiles", "complete"}:
            raise AccessError(403, "app_forbidden", "Sua permissão não inclui cálculos de perfis nesta calculadora.")
        if has_glass and (app_id not in {"glass", "complete"} or not principal["apps"]["glass"]):
            raise AccessError(403, "app_forbidden", "Sua permissão não inclui cálculos de vidro.")


def install_calculator_access(app, manager=None):
    manager = manager or AccessManager.from_environment()
    app.extensions["calculator_access"] = manager

    @app.errorhandler(AccessError)
    def access_error(error):
        return jsonify({"error": str(error), "code": error.code, "contactEmail": manager.contact_email}), error.status

    @app.before_request
    def protect_calculators():
        if request.path in CALCULATOR_PATHS and request.method != "OPTIONS":
            manager.authorize_calculation()

    @app.after_request
    def prevent_private_response_cache(response):
        if request.path in CALCULATOR_PATHS or request.path.startswith("/auth/"):
            response.headers["Cache-Control"] = "private, no-store"
            response.headers["X-Content-Type-Options"] = "nosniff"
            response.vary.add("Authorization")
        return response

    @app.get("/auth/config")
    def calculator_auth_config():
        config = manager.web_config
        if not all(isinstance(config.get(key), str) and config[key] for key in ("apiKey", "authDomain", "projectId", "appId")):
            raise AccessError(503, "auth_unavailable", "O login ainda não foi configurado. Entre em contato para solicitar acesso.")
        return jsonify({"firebase": {key: config[key] for key in ("apiKey", "authDomain", "projectId", "appId")}, "contactEmail": manager.contact_email})

    @app.get("/auth/me")
    def calculator_auth_me():
        return jsonify(manager.authenticate())

    @app.get("/auth/access")
    def calculator_access_list():
        manager.require_admin()
        try:
            entries = manager.backend.list_entries()
            return jsonify({"users": [{key: item.get(key) for key in ("id", "email", "active", "apps")} for item in entries]})
        except Exception:
            raise AccessError(503, "access_unavailable", "Não foi possível carregar as permissões.") from None

    @app.put("/auth/access")
    def calculator_access_put():
        principal = manager.require_admin()
        data = request.get_json(silent=True)
        if not isinstance(data, dict) or set(data) - {"email", "active", "apps"}:
            raise AccessError(400, "invalid_payload", "Dados de permissão inválidos.")
        try:
            email = normalize_email(data.get("email"))
        except ValueError as error:
            raise AccessError(400, "invalid_email", str(error)) from None
        apps = data.get("apps")
        if type(data.get("active")) is not bool or not isinstance(apps, dict) or set(apps) - APP_IDS or any(type(value) is not bool for value in apps.values()):
            raise AccessError(400, "invalid_payload", "Selecione permissões válidas para os apps.")
        entry = {"active": data["active"], "apps": {key: apps.get(key, False) for key in sorted(APP_IDS)}}
        try:
            manager.backend.put_entry(email, entry, principal["uid"])
        except Exception:
            raise AccessError(503, "access_unavailable", "Não foi possível salvar as permissões.") from None
        logger.info("Calculator permissions updated by uid=%s", principal["uid"])
        return jsonify({"email": email, **entry})

    @app.delete("/auth/access/<key>")
    def calculator_access_delete(key):
        principal = manager.require_admin()
        if not re.fullmatch(r"[a-f0-9]{64}", key):
            raise AccessError(400, "invalid_payload", "Identificador inválido.")
        try:
            manager.backend.delete_entry(key)
        except Exception:
            raise AccessError(503, "access_unavailable", "Não foi possível remover a permissão.") from None
        logger.info("Calculator permission removed by uid=%s", principal["uid"])
        return jsonify({"deleted": True})

    return manager
