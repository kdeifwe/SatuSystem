from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .config import Settings, load_settings
from .crypto import SessionCipher
from .errors import WorkerError
from .manager import IgManager
from .store import ChannelStore
from .util import secrets_equal

log = logging.getLogger("ig.api")


class LoginIn(BaseModel):
    channel_id: str = Field(min_length=1, max_length=64)
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)

    def __repr__(self) -> str:  # пароль не должен попадать в логи
        return f"LoginIn(channel_id={self.channel_id!r}, username={self.username!r}, password=***)"

    __str__ = __repr__


class VerifyIn(BaseModel):
    channel_id: str = Field(min_length=1, max_length=64)
    code: str = Field(min_length=1, max_length=16)

    def __repr__(self) -> str:
        return f"VerifyIn(channel_id={self.channel_id!r}, code=***)"

    __str__ = __repr__


class SendIn(BaseModel):
    channel_id: str = Field(min_length=1, max_length=64)
    thread_id: str = Field(min_length=1, max_length=64)
    text: str = Field(min_length=1, max_length=8000)


def build_manager(settings: Settings) -> IgManager:
    store = ChannelStore(settings.supabase_url, settings.supabase_key)
    cipher = SessionCipher(settings.encryption_key)
    return IgManager(settings, store, cipher)


def create_app(settings: Settings | None = None, manager: IgManager | None = None, *, start_manager: bool = True) -> FastAPI:
    cfg = settings or load_settings()
    mgr = manager or build_manager(cfg)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        if start_manager:
            await mgr.start()
        yield
        if start_manager:
            await mgr.shutdown()

    app = FastAPI(title="ig-worker", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.state.manager = mgr

    def require_auth(authorization: str | None = Header(default=None)) -> None:
        prefix = "Bearer "
        if not authorization or not authorization.startswith(prefix):
            raise HTTPException(status_code=401, detail="unauthorized")
        if not secrets_equal(authorization[len(prefix):], cfg.worker_secret):
            raise HTTPException(status_code=401, detail="unauthorized")

    @app.exception_handler(WorkerError)
    async def worker_error_handler(_req: Request, exc: WorkerError):
        return JSONResponse(status_code=exc.http_status, content={"error": exc.message, "code": exc.code})

    @app.exception_handler(RequestValidationError)
    async def validation_handler(_req: Request, _exc: RequestValidationError):
        # не возвращаем input, чтобы пароль/код не попали в ответ
        return JSONResponse(status_code=422, content={"error": "Некорректный запрос", "code": "validation"})

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return {"ok": True, "ready": mgr.ready, "channels": len(mgr.runtimes)}

    @app.post("/login", dependencies=[Depends(require_auth)])
    async def login(body: LoginIn) -> dict[str, Any]:
        return await mgr.login(body.channel_id, body.username, body.password)

    @app.post("/verify", dependencies=[Depends(require_auth)])
    async def verify(body: VerifyIn) -> dict[str, Any]:
        return await mgr.verify(body.channel_id, body.code)

    @app.post("/send", dependencies=[Depends(require_auth)])
    async def send(body: SendIn) -> dict[str, Any]:
        return await mgr.send(body.channel_id, body.thread_id, body.text)

    @app.get("/status/{channel_id}", dependencies=[Depends(require_auth)])
    async def status(channel_id: str) -> dict[str, Any]:
        return await mgr.status(channel_id)

    @app.post("/logout/{channel_id}", dependencies=[Depends(require_auth)])
    async def logout(channel_id: str) -> dict[str, Any]:
        return await mgr.logout(channel_id)

    return app


def _configure_logging() -> None:
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    for noisy in ("httpx", "httpcore", "instagrapi", "private_request", "public_request"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def create_production_app() -> FastAPI:
    _configure_logging()
    return create_app()
