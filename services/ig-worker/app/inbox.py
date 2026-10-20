from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable

TEXT_ITEM_TYPES = {"text", "link"}


@dataclass(frozen=True)
class InboundMessage:
    message_id: str
    thread_id: str
    sender_id: str
    sender_username: str | None
    sender_name: str | None
    text: str
    timestamp: str  # ISO-8601 UTC

    def to_payload(self, channel_id: str) -> dict[str, Any]:
        return {
            "channel_id": channel_id,
            "thread_id": self.thread_id,
            "sender_id": self.sender_id,
            "sender_username": self.sender_username,
            "sender_name": self.sender_name,
            "message_id": self.message_id,
            "text": self.text,
            "timestamp": self.timestamp,
        }


class SeenCache:
    """Ограниченный по размеру набор уже обработанных id сообщений."""

    def __init__(self, limit: int = 5000) -> None:
        self._items: OrderedDict[str, None] = OrderedDict()
        self._limit = limit

    def add(self, message_id: str) -> None:
        self._items[message_id] = None
        self._items.move_to_end(message_id)
        while len(self._items) > self._limit:
            self._items.popitem(last=False)

    def __contains__(self, message_id: object) -> bool:
        return message_id in self._items

    def __len__(self) -> int:
        return len(self._items)


def _aware(value: datetime | None) -> datetime:
    if value is None:
        return datetime.now(timezone.utc)
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _item_type(message: Any) -> str:
    raw = getattr(message, "item_type", None)
    return str(raw or "").lower()


def extract_new_messages(
    threads: Iterable[Any],
    *,
    own_id: str,
    seen: SeenCache,
    first_poll: bool,
    cutoff: datetime,
) -> list[InboundMessage]:
    """Возвращает новые входящие текстовые сообщения (старые первыми).

    Всё, что не нужно обрабатывать (свои, нетекстовые, из групп, старше cutoff при первом опросе),
    сразу помечается как seen. Возвращённые сообщения помечаются seen только после успешной доставки.
    """
    result: list[InboundMessage] = []
    own = str(own_id)

    for thread in threads:
        users = list(getattr(thread, "users", None) or [])
        is_group = bool(getattr(thread, "is_group", False)) or len(users) > 1
        thread_id = str(getattr(thread, "id", "") or getattr(thread, "pk", "") or "")
        messages = list(getattr(thread, "messages", None) or [])

        for message in messages:
            message_id = str(getattr(message, "id", "") or "")
            if not message_id or message_id in seen:
                continue

            sender_id = str(getattr(message, "user_id", "") or "")
            if is_group or not thread_id:
                seen.add(message_id)
                continue
            if getattr(message, "is_sent_by_viewer", False) or sender_id == own:
                seen.add(message_id)
                continue

            text = (getattr(message, "text", None) or "").strip()
            if _item_type(message) not in TEXT_ITEM_TYPES or not text:
                seen.add(message_id)
                continue

            when = _aware(getattr(message, "timestamp", None))
            if first_poll and when < cutoff:
                seen.add(message_id)
                continue

            sender = next((u for u in users if str(getattr(u, "pk", "")) == sender_id), None)
            result.append(
                InboundMessage(
                    message_id=message_id,
                    thread_id=thread_id,
                    sender_id=sender_id,
                    sender_username=(getattr(sender, "username", None) or None) if sender else None,
                    sender_name=(getattr(sender, "full_name", None) or None) if sender else None,
                    text=text,
                    timestamp=when.isoformat(),
                )
            )

    result.sort(key=lambda m: m.timestamp)
    return result
