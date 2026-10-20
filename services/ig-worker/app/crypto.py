from __future__ import annotations

import json
from typing import Any

from cryptography.fernet import Fernet, InvalidToken


class CryptoError(RuntimeError):
    pass


class SessionCipher:
    """Шифрует сессию instagrapi (cookies, токены, device id) перед записью в БД."""

    def __init__(self, key: str) -> None:
        try:
            self._fernet = Fernet(key.encode())
        except Exception as exc:  # неверный формат ключа
            raise CryptoError("IG_SESSION_ENCRYPTION_KEY is not a valid Fernet key") from exc

    def encrypt(self, data: dict[str, Any]) -> str:
        raw = json.dumps(data, separators=(",", ":"), default=str).encode()
        return self._fernet.encrypt(raw).decode()

    def decrypt(self, token: str) -> dict[str, Any]:
        try:
            raw = self._fernet.decrypt(token.encode())
        except InvalidToken as exc:
            raise CryptoError("Cannot decrypt session: wrong IG_SESSION_ENCRYPTION_KEY or corrupted data") from exc
        return json.loads(raw)
