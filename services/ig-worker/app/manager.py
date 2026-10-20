from __future__ import annotations

import asyncio
import json
import logging
import queue
import random
import re
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

import httpx

from .config import Settings
from .crypto import CryptoError, SessionCipher
from .errors import ErrorKind, WorkerError, classify_error, user_message
from .inbox import InboundMessage, SeenCache, extract_new_messages
from .store import ChannelStore
from .util import chunk_text, sign_body

log = logging.getLogger("ig.manager")

CODE_RE = re.compile(r"^\d{4,10}$")
THREAD_ID_RE = re.compile(r"^\d{1,40}$")
THROTTLE_PAUSE_SEC = 30 * 60
MAX_CONSECUTIVE_FAILURES = 8


@dataclass
class Runtime:
    channel_id: str
    username: str
    client: Any = None
    status: str = "disconnected"  # connecting | connected | challenge | 2fa | error | disconnected
    last_error: str | None = None
    own_id: str | None = None
    pending_password: str | None = None  # только в памяти, пока ждём код 2FA
    device_settings: dict[str, Any] | None = None
    code_queue: "queue.Queue[str]" = field(default_factory=queue.Queue)
    changed: asyncio.Event = field(default_factory=asyncio.Event)
    poll_task: asyncio.Task | None = None
    login_task: asyncio.Task | None = None
    seen: SeenCache = field(default_factory=SeenCache)
    first_poll_done: bool = False
    send_times: deque = field(default_factory=deque)
    paused_until: float = 0.0
    last_persist: float = 0.0
    last_poll_at: float | None = None
    poll_count: int = 0
    consecutive_failures: int = 0
    op_lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class IgManager:
    def __init__(
        self,
        settings: Settings,
        store: ChannelStore,
        cipher: SessionCipher,
        http: httpx.AsyncClient | None = None,
        client_factory: Callable[[dict[str, Any] | None], Any] | None = None,
    ) -> None:
        self.settings = settings
        self.store = store
        self.cipher = cipher
        self._http = http or httpx.AsyncClient(timeout=20)
        self._client_factory = client_factory or self._default_client
        self.runtimes: dict[str, Runtime] = {}
        self.ready = False
        self._loop: asyncio.AbstractEventLoop | None = None
        self._restore_task: asyncio.Task | None = None
        self._background: set[asyncio.Task] = set()

    def _spawn(self, coro: Any) -> None:
        """Фоновая задача со ссылкой, чтобы её не собрал GC."""
        task = asyncio.create_task(coro)
        self._background.add(task)
        task.add_done_callback(self._background.discard)

    # ------------------------------------------------------------------ lifecycle

    async def start(self) -> None:
        self._loop = asyncio.get_running_loop()
        self._restore_task = asyncio.create_task(self._restore_all())

    async def shutdown(self) -> None:
        if self._restore_task:
            self._restore_task.cancel()
        for rt in list(self.runtimes.values()):
            for task in (rt.poll_task, rt.login_task):
                if task:
                    task.cancel()
            if rt.status == "connected" and rt.client is not None:
                try:
                    await self._persist(rt)
                except Exception:  # noqa: BLE001
                    log.warning("persist on shutdown failed channel=%s", rt.channel_id)
        await self._http.aclose()
        await self.store.aclose()

    # ------------------------------------------------------------------ client

    def _default_client(self, settings: dict[str, Any] | None):
        from instagrapi import Client  # импорт тут, чтобы тесты без сети не тянули всё

        client = Client(settings=settings or {}, delay_range=[1, 3])
        if self.settings.proxy_url:
            client.set_proxy(self.settings.proxy_url)
        if not settings:
            client.set_locale(self.settings.locale)
            client.set_timezone_offset(self.settings.timezone_offset_sec)
        return client

    # ------------------------------------------------------------------ public API

    def snapshot(self, rt: Runtime) -> dict[str, Any]:
        return {
            "status": rt.status,
            "username": rt.username,
            "last_error": rt.last_error,
            "challenge_type": rt.status if rt.status in {"challenge", "2fa"} else None,
        }

    async def status(self, channel_id: str) -> dict[str, Any]:
        rt = self.runtimes.get(channel_id)
        if rt:
            data = self.snapshot(rt)
            data["paused_until"] = rt.paused_until or None
            data["last_poll_at"] = rt.last_poll_at
            return data
        row = await self.store.get_channel(channel_id)
        if not row:
            return {"status": "disconnected", "username": None, "last_error": None, "challenge_type": None}
        creds = row.get("credentials") or {}
        status = row.get("connection_status") or "disconnected"
        if status == "connected":
            # в БД «connected», но в памяти сессии нет (идёт восстановление после рестарта)
            status = "connecting" if not self.ready else "error"
        return {
            "status": status,
            "username": creds.get("username"),
            "last_error": creds.get("last_error"),
            "challenge_type": status if status in {"challenge", "2fa"} else None,
        }

    async def login(self, channel_id: str, username: str, password: str) -> dict[str, Any]:
        username = username.strip().lstrip("@")
        if not username or not password:
            raise WorkerError("Логин и пароль обязательны", 400, "bad_request")
        row = await self.store.get_channel(channel_id)
        if not row:
            raise WorkerError("Канал не найден", 404, "channel_not_found")

        previous = self.runtimes.get(channel_id)
        device = None
        if previous:
            if previous.username == username:
                device = previous.device_settings
            await self._stop(previous)

        rt = Runtime(channel_id=channel_id, username=username, device_settings=device)
        rt.status = "connecting"
        self.runtimes[channel_id] = rt
        rt.login_task = asyncio.create_task(self._login_flow(rt, password, ""))
        await self._wait_state(rt, timeout=120)
        return self.snapshot(rt)

    async def verify(self, channel_id: str, code: str) -> dict[str, Any]:
        code = (code or "").strip().replace(" ", "")
        if not CODE_RE.match(code):
            raise WorkerError("Код должен состоять из 4–10 цифр", 400, "bad_code")
        rt = self.runtimes.get(channel_id)
        if not rt:
            raise WorkerError("Сначала выполните вход", 409, "no_login_in_progress")

        if rt.status == "challenge":
            rt.status = "connecting"
            rt.code_queue.put(code)
        elif rt.status == "2fa" and rt.pending_password:
            password = rt.pending_password
            rt.status = "connecting"
            rt.login_task = asyncio.create_task(self._login_flow(rt, password, code))
        else:
            raise WorkerError("Подтверждение сейчас не требуется", 409, "not_waiting_for_code")

        await self._wait_state(rt, timeout=120)
        return self.snapshot(rt)

    async def send(self, channel_id: str, thread_id: str, text: str) -> dict[str, Any]:
        rt = self.runtimes.get(channel_id)
        if not rt or rt.status != "connected" or rt.client is None:
            raise WorkerError("Instagram не подключён", 409, "not_connected")
        if not THREAD_ID_RE.match(str(thread_id)):
            raise WorkerError("Некорректный thread_id", 400, "bad_thread_id")
        if time.time() < rt.paused_until:
            raise WorkerError("Instagram ограничил запросы, отправка на паузе", 429, "paused")

        chunks = chunk_text(text)
        if not chunks:
            raise WorkerError("Пустое сообщение", 400, "empty")

        cutoff = time.time() - 3600
        while rt.send_times and rt.send_times[0] < cutoff:
            rt.send_times.popleft()
        if len(rt.send_times) + len(chunks) > self.settings.max_sends_per_hour:
            raise WorkerError("Превышен лимит отправки в час для этого аккаунта", 429, "rate_limit")

        try:
            for index, chunk in enumerate(chunks):
                await asyncio.sleep(random.uniform(self.settings.send_jitter_min, self.settings.send_jitter_max))
                if index > 0:
                    await asyncio.sleep(random.uniform(0.8, 1.8))
                async with rt.op_lock:
                    await asyncio.to_thread(self._direct_send, rt.client, chunk, int(thread_id))
                rt.send_times.append(time.time())
        except Exception as exc:  # noqa: BLE001
            kind = classify_error(exc)
            log.warning("send failed channel=%s kind=%s err=%s", channel_id, kind.value, type(exc).__name__)
            if kind == ErrorKind.THROTTLED:
                await self._pause(rt)
                raise WorkerError(user_message(kind), 429, "throttled") from exc
            if kind in {ErrorKind.SESSION_EXPIRED, ErrorKind.CHALLENGE, ErrorKind.PROXY}:
                await self._fail(rt, kind)
                raise WorkerError(user_message(kind), 409, "not_connected") from exc
            raise WorkerError("Не удалось отправить сообщение в Instagram", 502, "send_failed") from exc
        return {"ok": True, "parts": len(chunks)}

    async def logout(self, channel_id: str) -> dict[str, Any]:
        rt = self.runtimes.pop(channel_id, None)
        if rt:
            client = rt.client
            was_connected = rt.status == "connected"
            await self._stop(rt)
            if client is not None and was_connected:
                try:
                    await asyncio.wait_for(asyncio.to_thread(client.logout), 20)
                except Exception:  # noqa: BLE001
                    log.info("remote logout failed (ignored) channel=%s", channel_id)
        await self.store.save_state(
            channel_id,
            status="disconnected",
            is_active=False,
            cred_patch={"session": None, "session_saved_at": None, "last_error": None, "ig_pk": None},
        )
        return {"status": "disconnected", "username": None, "last_error": None, "challenge_type": None}

    # ------------------------------------------------------------------ login flow

    @staticmethod
    def _direct_send(client: Any, text: str, thread_id: int) -> Any:
        return client.direct_send(text, [], [thread_id])

    async def _wait_state(self, rt: Runtime, timeout: float) -> None:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        while rt.status == "connecting":
            remaining = deadline - loop.time()
            if remaining <= 0:
                break
            rt.changed.clear()
            try:
                await asyncio.wait_for(rt.changed.wait(), remaining)
            except asyncio.TimeoutError:
                break

    def _wait_code(self, rt: Runtime) -> str | bool:
        """Вызывается instagrapi в потоке логина, когда Instagram прислал код на почту/SMS."""
        if self._loop is not None:
            self._loop.call_soon_threadsafe(self._enter_challenge, rt)
        try:
            return rt.code_queue.get(timeout=self.settings.challenge_wait_sec) or False
        except queue.Empty:
            return False

    def _enter_challenge(self, rt: Runtime) -> None:
        rt.status = "challenge"
        rt.last_error = None
        rt.changed.set()
        self._spawn(self._safe_save(rt.channel_id, status="challenge", is_active=False,
                                    cred_patch={"last_error": None}))

    async def _login_flow(self, rt: Runtime, password: str, code: str) -> None:
        try:
            client = rt.client if (code and rt.client is not None) else self._client_factory(rt.device_settings)
            client.challenge_code_handler = lambda _username, _choice: self._wait_code(rt)
            rt.client = client
            await asyncio.to_thread(lambda: client.login(rt.username, password, verification_code=code))
            rt.own_id = str(client.user_id)
            rt.pending_password = None
            await self._on_connected(rt)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            kind = classify_error(exc)
            log.warning("login failed channel=%s kind=%s err=%s", rt.channel_id, kind.value, type(exc).__name__)
            self._remember_device(rt)
            if kind == ErrorKind.TWO_FACTOR and not code:
                rt.pending_password = password
                await self._set_status(rt, "2fa", None, is_active=False)
            else:
                rt.pending_password = None
                await self._set_status(rt, "error", user_message(kind), is_active=False)

    def _remember_device(self, rt: Runtime) -> None:
        """Сохраняем device-настройки в памяти, чтобы повторная попытка шла с тем же «устройством»."""
        try:
            if rt.client is not None:
                rt.device_settings = rt.client.get_settings()
        except Exception:  # noqa: BLE001
            pass

    async def _on_connected(self, rt: Runtime) -> None:
        rt.status = "connected"
        rt.last_error = None
        rt.first_poll_done = False
        rt.consecutive_failures = 0
        rt.last_persist = 0.0
        await self._persist(rt, status="connected", is_active=True,
                            extra={"last_error": None, "username": rt.username})
        rt.poll_task = asyncio.create_task(self._poll_loop(rt))
        rt.changed.set()
        log.info("connected channel=%s", rt.channel_id)

    # ------------------------------------------------------------------ persistence

    async def _persist(self, rt: Runtime, *, status: str | None = None, is_active: bool | None = None,
                       extra: dict[str, Any] | None = None) -> None:
        settings = rt.client.get_settings()
        patch: dict[str, Any] = {
            "session": self.cipher.encrypt(settings),
            "session_saved_at": datetime.now(timezone.utc).isoformat(),
            "ig_pk": rt.own_id,
        }
        if extra:
            patch.update(extra)
        await self.store.save_state(rt.channel_id, status=status, is_active=is_active, cred_patch=patch)
        rt.last_persist = time.time()

    async def _safe_save(self, channel_id: str, **kwargs: Any) -> None:
        try:
            await self.store.save_state(channel_id, **kwargs)
        except Exception as exc:  # noqa: BLE001
            log.warning("db save failed channel=%s err=%s", channel_id, type(exc).__name__)

    async def _set_status(self, rt: Runtime, status: str, error: str | None, *, is_active: bool) -> None:
        rt.status = status
        rt.last_error = error
        rt.changed.set()
        await self._safe_save(rt.channel_id, status=status, is_active=is_active, cred_patch={"last_error": error})

    async def _fail(self, rt: Runtime, kind: ErrorKind) -> None:
        patch_session_cleared = kind == ErrorKind.SESSION_EXPIRED
        current = asyncio.current_task()
        if rt.poll_task and rt.poll_task is not current:
            rt.poll_task.cancel()
        rt.status = "error"
        rt.last_error = user_message(kind)
        rt.changed.set()
        patch: dict[str, Any] = {"last_error": rt.last_error}
        if patch_session_cleared:
            patch["session"] = None
        await self._safe_save(rt.channel_id, status="error", is_active=False, cred_patch=patch)

    async def _pause(self, rt: Runtime) -> None:
        rt.paused_until = time.time() + THROTTLE_PAUSE_SEC
        until = datetime.now(timezone.utc) + timedelta(seconds=THROTTLE_PAUSE_SEC)
        rt.last_error = f"{user_message(ErrorKind.THROTTLED)} До {until.strftime('%H:%M')} UTC."
        await self._safe_save(rt.channel_id, cred_patch={"last_error": rt.last_error})

    async def _stop(self, rt: Runtime) -> None:
        for task in (rt.poll_task, rt.login_task):
            if task and not task.done() and task is not asyncio.current_task():
                task.cancel()
        rt.code_queue.put("")  # разбудить поток, ждущий код
        rt.status = "disconnected"
        rt.changed.set()

    # ------------------------------------------------------------------ restore

    async def _restore_all(self) -> None:
        try:
            rows = await self.store.list_userbot_channels()
        except Exception as exc:  # noqa: BLE001
            log.error("cannot list channels for restore err=%s", type(exc).__name__)
            self.ready = True
            return
        candidates = [r for r in rows if (r.get("credentials") or {}).get("session")]
        log.info("restoring %d instagram session(s)", len(candidates))
        for index, row in enumerate(candidates):
            if index:
                await asyncio.sleep(random.uniform(2, 6))
            try:
                await self._restore_one(row)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                log.error("restore failed channel=%s err=%s", row.get("id"), type(exc).__name__)
        self.ready = True

    async def _restore_one(self, row: dict[str, Any]) -> None:
        channel_id = str(row["id"])
        creds = row.get("credentials") or {}
        rt = Runtime(channel_id=channel_id, username=str(creds.get("username") or ""))
        rt.status = "connecting"
        self.runtimes[channel_id] = rt
        try:
            settings = self.cipher.decrypt(str(creds["session"]))
        except CryptoError:
            await self._set_status(rt, "error", "Не удалось расшифровать сессию. Подключите аккаунт заново.", is_active=False)
            return

        for attempt, delay in enumerate((0, 15, 45), start=1):
            if delay:
                await asyncio.sleep(delay)
            try:
                client = self._client_factory(settings)
                client.challenge_code_handler = lambda _u, _c: False
                await asyncio.to_thread(client.account_info)
                rt.client = client
                rt.own_id = str(client.user_id)
                await self._on_connected(rt)
                return
            except Exception as exc:  # noqa: BLE001
                kind = classify_error(exc)
                log.warning("restore attempt %d channel=%s kind=%s", attempt, channel_id, kind.value)
                if kind not in {ErrorKind.TRANSIENT, ErrorKind.OTHER} or attempt == 3:
                    await self._fail(rt, kind)
                    return

    # ------------------------------------------------------------------ polling

    @staticmethod
    def _fetch_threads(client: Any, amount: int, include_pending: bool) -> list[Any]:
        threads = list(client.direct_threads(amount=amount, thread_message_limit=5))
        if include_pending:
            threads += list(client.direct_pending_inbox(amount=amount))
        return threads

    async def _poll_loop(self, rt: Runtime) -> None:
        s = self.settings
        try:
            while rt.status == "connected":
                await asyncio.sleep(random.uniform(s.poll_min_sec, s.poll_max_sec))
                if rt.status != "connected":
                    break
                if time.time() < rt.paused_until:
                    continue
                try:
                    await self._poll_once(rt)
                    rt.consecutive_failures = 0
                    if time.time() - rt.last_persist > s.persist_interval_sec:
                        await self._persist(rt)
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # noqa: BLE001
                    if not await self._handle_poll_error(rt, exc):
                        break
        except asyncio.CancelledError:
            pass

    async def _poll_once(self, rt: Runtime) -> None:
        include_pending = self.settings.poll_pending and rt.poll_count % 3 == 0
        rt.poll_count += 1
        async with rt.op_lock:
            threads = await asyncio.to_thread(self._fetch_threads, rt.client, self.settings.inbox_amount, include_pending)
        rt.last_poll_at = time.time()

        cutoff = datetime.now(timezone.utc) - timedelta(minutes=self.settings.backfill_minutes)
        messages = extract_new_messages(
            threads,
            own_id=rt.own_id or "",
            seen=rt.seen,
            first_poll=not rt.first_poll_done,
            cutoff=cutoff,
        )
        rt.first_poll_done = True
        for message in messages:
            if await self._deliver(rt, message):
                rt.seen.add(message.message_id)
            else:
                break  # повторим на следующем цикле, порядок сохраняем

    async def _handle_poll_error(self, rt: Runtime, exc: BaseException) -> bool:
        """True — продолжаем опрос, False — остановить цикл."""
        kind = classify_error(exc)
        log.warning("poll error channel=%s kind=%s err=%s", rt.channel_id, kind.value, type(exc).__name__)
        if kind == ErrorKind.THROTTLED:
            await self._pause(rt)
            return True
        if kind in {ErrorKind.TRANSIENT, ErrorKind.OTHER}:
            rt.consecutive_failures += 1
            if rt.consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
                await self._fail(rt, ErrorKind.TRANSIENT)
                return False
            await asyncio.sleep(min(300, 15 * 2 ** rt.consecutive_failures))
            return True
        await self._fail(rt, kind)
        return False

    async def _deliver(self, rt: Runtime, message: InboundMessage) -> bool:
        body = json.dumps(message.to_payload(rt.channel_id), ensure_ascii=False, separators=(",", ":")).encode()
        for attempt in range(3):
            timestamp = str(int(time.time()))
            headers = {
                "content-type": "application/json",
                "x-ig-timestamp": timestamp,
                "x-ig-signature": sign_body(self.settings.worker_secret, timestamp, body),
            }
            try:
                response = await self._http.post(self.settings.next_inbound_url, content=body, headers=headers)
                if 200 <= response.status_code < 300:
                    return True
                log.warning("inbound rejected status=%s attempt=%d", response.status_code, attempt + 1)
            except httpx.HTTPError as exc:
                log.warning("inbound post failed err=%s attempt=%d", type(exc).__name__, attempt + 1)
            await asyncio.sleep(2 ** attempt)
        return False
