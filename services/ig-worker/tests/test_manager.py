import asyncio
import json
import time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace as NS

import httpx
import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from instagrapi import exceptions as igx

from app.config import Settings
from app.crypto import SessionCipher
from app.errors import WorkerError
from app.main import create_app
from app.manager import IgManager
from app.util import sign_body

KEY = Fernet.generate_key().decode()
SECRET = "worker-secret"


class FakeStore:
    def __init__(self):
        self.rows = {"ch1": {"id": "ch1", "credentials": {"provider": "userbot", "agent_id": "a1"}, "is_active": False, "connection_status": "disconnected"}}
        self.saves = []

    async def get_channel(self, channel_id):
        return self.rows.get(channel_id)

    async def list_userbot_channels(self):
        return list(self.rows.values())

    async def save_state(self, channel_id, *, status=None, is_active=None, cred_patch=None):
        row = self.rows[channel_id]
        if status is not None:
            row["connection_status"] = status
        if is_active is not None:
            row["is_active"] = is_active
        for k, v in (cred_patch or {}).items():
            if v is None:
                row["credentials"].pop(k, None)
            else:
                row["credentials"][k] = v
        self.saves.append((status, is_active, dict(cred_patch or {})))

    async def aclose(self):
        pass


class FakeClient:
    """Имитация instagrapi.Client."""

    def __init__(self, mode="ok", threads=None):
        self.mode = mode
        self.user_id = 999
        self.threads = threads or []
        self.sent = []
        self.challenge_code_handler = None
        self.logged_in_with = None

    def login(self, username, password, relogin=False, verification_code=""):
        self.logged_in_with = (username, password, verification_code)
        if self.mode == "bad_password":
            raise igx.BadPassword("bad")
        if self.mode == "2fa" and not verification_code:
            raise igx.TwoFactorRequired("need code")
        if self.mode == "challenge":
            code = self.challenge_code_handler(username, None)
            if not code:
                raise igx.ChallengeRequired("no code")
            assert code == "654321"
        return True

    def get_settings(self):
        return {"uuids": {"x": 1}, "authorization_data": {"ds_user_id": "999"}}

    def account_info(self):
        return NS(pk=999)

    def direct_threads(self, amount=20, thread_message_limit=None, **_):
        return self.threads

    def direct_pending_inbox(self, amount=20):
        return []

    def direct_send(self, text, user_ids=(), thread_ids=()):
        if self.mode == "throttle":
            raise igx.PleaseWaitFewMinutes("slow down")
        self.sent.append((text, list(thread_ids)))
        return NS(id="sent")

    def logout(self):
        return True


def make_settings(**kw):
    base = dict(
        worker_secret=SECRET,
        encryption_key=KEY,
        supabase_url="http://x",
        supabase_key="k",
        next_inbound_url="http://next.local/api/instagram/inbound",
        poll_min_sec=0.01,
        poll_max_sec=0.02,
        poll_pending=False,
        send_jitter_min=0.0,
        send_jitter_max=0.0,
        challenge_wait_sec=5,
        max_sends_per_hour=3,
    )
    base.update(kw)
    return Settings(**base)


def make_manager(client, handler=None, **settings_kw):
    store = FakeStore()
    calls = []

    def default_handler(request: httpx.Request):
        calls.append(request)
        return httpx.Response(200, json={"ok": True})

    http = httpx.AsyncClient(transport=httpx.MockTransport(handler or default_handler))
    mgr = IgManager(make_settings(**settings_kw), store, SessionCipher(KEY), http=http, client_factory=lambda _s: client)
    return mgr, store, calls


def run(coro):
    return asyncio.run(coro)


def test_login_success_persists_encrypted_session():
    async def scenario():
        client = FakeClient()
        mgr, store, _ = make_manager(client)
        await mgr.start()
        result = await mgr.login("ch1", "@shop", "pw")
        assert result["status"] == "connected" and result["username"] == "shop"
        creds = store.rows["ch1"]["credentials"]
        assert store.rows["ch1"]["is_active"] is True
        assert "pw" not in json.dumps(creds)  # пароль нигде не хранится
        assert SessionCipher(KEY).decrypt(creds["session"])["uuids"] == {"x": 1}
        assert creds["agent_id"] == "a1" and creds["ig_pk"] == "999"
        await mgr.shutdown()

    run(scenario())


def test_bad_password_sets_error():
    async def scenario():
        mgr, store, _ = make_manager(FakeClient("bad_password"))
        await mgr.start()
        result = await mgr.login("ch1", "shop", "pw")
        assert result["status"] == "error"
        assert "Неверный логин" in result["last_error"]
        assert store.rows["ch1"]["connection_status"] == "error"
        assert store.rows["ch1"]["is_active"] is False
        await mgr.shutdown()

    run(scenario())


def test_two_factor_flow():
    async def scenario():
        client = FakeClient("2fa")
        mgr, store, _ = make_manager(client)
        await mgr.start()
        first = await mgr.login("ch1", "shop", "pw")
        assert first["status"] == "2fa" and first["challenge_type"] == "2fa"
        with pytest.raises(WorkerError):
            await mgr.verify("ch1", "abc")
        done = await mgr.verify("ch1", "123456")
        assert done["status"] == "connected"
        assert client.logged_in_with == ("shop", "pw", "123456")
        assert mgr.runtimes["ch1"].pending_password is None
        await mgr.shutdown()

    run(scenario())


def test_challenge_flow_blocks_until_code():
    async def scenario():
        mgr, store, _ = make_manager(FakeClient("challenge"))
        await mgr.start()
        first = await mgr.login("ch1", "shop", "pw")
        assert first["status"] == "challenge"
        await asyncio.sleep(0.05)  # фоновая запись статуса в БД
        assert store.rows["ch1"]["connection_status"] == "challenge"
        done = await mgr.verify("ch1", "654321")
        assert done["status"] == "connected"
        await mgr.shutdown()

    run(scenario())


def test_challenge_timeout_becomes_error():
    async def scenario():
        mgr, _, _ = make_manager(FakeClient("challenge"), challenge_wait_sec=1)
        await mgr.start()
        first = await mgr.login("ch1", "shop", "pw")
        assert first["status"] == "challenge"
        await asyncio.sleep(1.6)
        assert mgr.runtimes["ch1"].status == "error"
        await mgr.shutdown()

    run(scenario())


def _incoming_thread(message_id="m1"):
    msg = NS(id=message_id, user_id=111, text="Сколько стоит?", item_type="text", is_sent_by_viewer=False,
             timestamp=datetime.now(timezone.utc) - timedelta(seconds=30))
    return NS(id="777", pk="777", users=[NS(pk=111, username="client", full_name="Клиент")], is_group=False, messages=[msg])


def test_polling_delivers_signed_payload_once():
    async def scenario():
        client = FakeClient(threads=[_incoming_thread()])
        mgr, _, calls = make_manager(client)
        await mgr.start()
        await mgr.login("ch1", "shop", "pw")
        await asyncio.sleep(0.4)  # несколько циклов опроса
        assert len(calls) == 1, "сообщение должно уйти ровно один раз"
        request = calls[0]
        body = request.content
        ts = request.headers["x-ig-timestamp"]
        assert request.headers["x-ig-signature"] == sign_body(SECRET, ts, body)
        payload = json.loads(body)
        assert payload["channel_id"] == "ch1" and payload["thread_id"] == "777"
        assert payload["message_id"] == "m1" and payload["text"] == "Сколько стоит?"
        assert payload["sender_username"] == "client"
        await mgr.shutdown()

    run(scenario())


def test_failed_delivery_is_retried_next_cycle():
    async def scenario():
        attempts = []

        def handler(request):
            attempts.append(1)
            return httpx.Response(500) if len(attempts) <= 3 else httpx.Response(200)

        client = FakeClient(threads=[_incoming_thread("m9")])
        mgr, _, _ = make_manager(client, handler=handler)
        await mgr.start()
        await mgr.login("ch1", "shop", "pw")
        deadline = time.time() + 20  # 3 попытки с паузами 1+2+4 c, затем следующий цикл опроса
        while "m9" not in mgr.runtimes["ch1"].seen and time.time() < deadline:
            await asyncio.sleep(0.2)
        assert len(attempts) >= 4
        assert "m9" in mgr.runtimes["ch1"].seen
        await mgr.shutdown()

    run(scenario())


def test_send_chunks_and_rate_limit():
    async def scenario():
        client = FakeClient()
        mgr, _, _ = make_manager(client)
        await mgr.start()
        await mgr.login("ch1", "shop", "pw")
        await mgr.send("ch1", "777", "Привет")
        assert client.sent == [("Привет", [777])]
        await mgr.send("ch1", "777", "Второе")
        await mgr.send("ch1", "777", "Третье")
        with pytest.raises(WorkerError) as err:
            await mgr.send("ch1", "777", "Четвёртое")
        assert err.value.http_status == 429 and err.value.code == "rate_limit"
        with pytest.raises(WorkerError):
            await mgr.send("ch1", "abc", "x")
        await mgr.shutdown()

    run(scenario())


def test_send_throttled_pauses_channel():
    async def scenario():
        client = FakeClient()
        mgr, _, _ = make_manager(client)
        await mgr.start()
        await mgr.login("ch1", "shop", "pw")
        client.mode = "throttle"
        with pytest.raises(WorkerError) as err:
            await mgr.send("ch1", "777", "x")
        assert err.value.http_status == 429
        assert mgr.runtimes["ch1"].paused_until > time.time() + 1000
        with pytest.raises(WorkerError) as err2:
            await mgr.send("ch1", "777", "x")
        assert err2.value.code == "paused"
        await mgr.shutdown()

    run(scenario())


def test_send_requires_connection_and_logout_clears_session():
    async def scenario():
        client = FakeClient()
        mgr, store, _ = make_manager(client)
        await mgr.start()
        with pytest.raises(WorkerError) as err:
            await mgr.send("ch1", "777", "x")
        assert err.value.code == "not_connected"
        await mgr.login("ch1", "shop", "pw")
        await mgr.logout("ch1")
        creds = store.rows["ch1"]["credentials"]
        assert "session" not in creds and store.rows["ch1"]["is_active"] is False
        assert creds["agent_id"] == "a1"  # чужие поля credentials не затронуты
        await mgr.shutdown()

    run(scenario())


def test_restore_from_saved_session():
    async def scenario():
        client = FakeClient()
        mgr, store, _ = make_manager(client)
        store.rows["ch1"]["credentials"].update(
            {"username": "shop", "session": SessionCipher(KEY).encrypt({"uuids": {"x": 1}})}
        )
        await mgr.start()
        await asyncio.wait_for(mgr._restore_task, 10)
        assert mgr.runtimes["ch1"].status == "connected" and mgr.ready
        await mgr.shutdown()

    run(scenario())


def test_restore_with_wrong_key_marks_error():
    async def scenario():
        mgr, store, _ = make_manager(FakeClient())
        store.rows["ch1"]["credentials"].update(
            {"username": "shop", "session": SessionCipher(Fernet.generate_key().decode()).encrypt({"a": 1})}
        )
        await mgr.start()
        await asyncio.wait_for(mgr._restore_task, 10)
        assert mgr.runtimes["ch1"].status == "error"
        assert "расшифровать" in store.rows["ch1"]["credentials"]["last_error"]
        await mgr.shutdown()

    run(scenario())


def test_api_auth_and_validation_do_not_leak():
    mgr, _, _ = make_manager(FakeClient())
    app = create_app(make_settings(), mgr, start_manager=False)
    client = TestClient(app)
    assert client.get("/health").status_code == 200
    assert client.get("/status/ch1").status_code == 401
    assert client.get("/status/ch1", headers={"Authorization": "Bearer wrong"}).status_code == 401
    ok = client.get("/status/ch1", headers={"Authorization": f"Bearer {SECRET}"})
    assert ok.status_code == 200 and ok.json()["status"] == "disconnected"
    bad = client.post("/login", headers={"Authorization": f"Bearer {SECRET}"}, json={"channel_id": "", "username": "u", "password": "SuperSecret123"})
    assert bad.status_code == 422 and "SuperSecret123" not in bad.text
    err = client.post("/send", headers={"Authorization": f"Bearer {SECRET}"}, json={"channel_id": "ch1", "thread_id": "1", "text": "x"})
    assert err.status_code == 409 and err.json()["code"] == "not_connected"
