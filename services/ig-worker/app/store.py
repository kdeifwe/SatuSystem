from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

log = logging.getLogger("ig.store")


class StoreError(RuntimeError):
    pass


class ChannelStore:
    """Минимальный клиент PostgREST для таблицы channels (service role)."""

    def __init__(self, base_url: str, service_key: str, client: httpx.AsyncClient | None = None) -> None:
        self._rest = f"{base_url.rstrip('/')}/rest/v1/channels"
        self._headers = {
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
        }
        self._http = client or httpx.AsyncClient(timeout=15)
        self._locks: dict[str, asyncio.Lock] = {}

    def _lock(self, channel_id: str) -> asyncio.Lock:
        return self._locks.setdefault(channel_id, asyncio.Lock())

    async def aclose(self) -> None:
        await self._http.aclose()

    async def get_channel(self, channel_id: str) -> dict[str, Any] | None:
        resp = await self._http.get(
            self._rest,
            headers=self._headers,
            params={
                "id": f"eq.{channel_id}",
                "type": "eq.instagram",
                "select": "id,org_id,credentials,is_active,connection_status",
            },
        )
        if resp.status_code >= 400:
            raise StoreError(f"channels select failed: {resp.status_code}")
        rows = resp.json()
        return rows[0] if rows else None

    async def list_userbot_channels(self) -> list[dict[str, Any]]:
        resp = await self._http.get(
            self._rest,
            headers=self._headers,
            params={
                "type": "eq.instagram",
                "credentials->>provider": "eq.userbot",
                "select": "id,credentials,is_active,connection_status",
            },
        )
        if resp.status_code >= 400:
            raise StoreError(f"channels list failed: {resp.status_code}")
        return resp.json()

    async def save_state(
        self,
        channel_id: str,
        *,
        status: str | None = None,
        is_active: bool | None = None,
        cred_patch: dict[str, Any] | None = None,
    ) -> None:
        """Обновляет статус и/или поля credentials. Значение None в cred_patch удаляет ключ."""
        async with self._lock(channel_id):
            payload: dict[str, Any] = {}
            if status is not None:
                payload["connection_status"] = status
            if is_active is not None:
                payload["is_active"] = is_active
            if cred_patch:
                row = await self.get_channel(channel_id)
                if row is None:
                    raise StoreError(f"channel {channel_id} not found")
                creds = dict(row.get("credentials") or {})
                for key, value in cred_patch.items():
                    if value is None:
                        creds.pop(key, None)
                    else:
                        creds[key] = value
                payload["credentials"] = creds
            if not payload:
                return
            resp = await self._http.patch(
                self._rest,
                headers={**self._headers, "Prefer": "return=minimal"},
                params={"id": f"eq.{channel_id}"},
                json=payload,
            )
            if resp.status_code >= 400:
                raise StoreError(f"channels update failed: {resp.status_code}")
