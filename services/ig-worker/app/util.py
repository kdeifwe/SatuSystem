from __future__ import annotations

import hashlib
import hmac
import re


def sign_body(secret: str, timestamp: str, body: bytes) -> str:
    """Подпись для /api/instagram/inbound: sha256=hex(HMAC(secret, "<ts>.<body>"))."""
    mac = hmac.new(secret.encode(), timestamp.encode() + b"." + body, hashlib.sha256)
    return "sha256=" + mac.hexdigest()


def secrets_equal(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


def chunk_text(text: str, limit: int = 900) -> list[str]:
    """Режет длинный текст на части <= limit, стараясь по абзацам/предложениям/пробелам."""
    text = (text or "").strip()
    if not text:
        return []
    if len(text) <= limit:
        return [text]

    chunks: list[str] = []
    rest = text
    while len(rest) > limit:
        window = rest[:limit]
        cut = max(window.rfind("\n\n"), window.rfind("\n"))
        if cut < limit // 3:
            match = None
            for match in re.finditer(r"[.!?…]\s", window):
                pass
            cut = match.end() if match else -1
        if cut < limit // 3:
            cut = window.rfind(" ")
        if cut < limit // 3:
            cut = limit
        chunks.append(rest[:cut].strip())
        rest = rest[cut:].strip()
    if rest:
        chunks.append(rest)
    return [c for c in chunks if c]
