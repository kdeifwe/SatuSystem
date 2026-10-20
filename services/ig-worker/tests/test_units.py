import hashlib
import hmac
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace as NS

import pytest
from cryptography.fernet import Fernet
from instagrapi import exceptions as igx

from app.crypto import CryptoError, SessionCipher
from app.errors import ErrorKind, classify_error
from app.inbox import SeenCache, extract_new_messages
from app.util import chunk_text, sign_body


def test_cipher_roundtrip_and_wrong_key():
    key = Fernet.generate_key().decode()
    cipher = SessionCipher(key)
    data = {"uuids": {"a": 1}, "cookies": {"sessionid": "secret"}}
    token = cipher.encrypt(data)
    assert "secret" not in token
    assert cipher.decrypt(token) == data
    with pytest.raises(CryptoError):
        SessionCipher(Fernet.generate_key().decode()).decrypt(token)
    with pytest.raises(CryptoError):
        SessionCipher("not-a-key")


def test_sign_body_matches_reference():
    body = b'{"a":1}'
    expected = "sha256=" + hmac.new(b"s3", b"123." + body, hashlib.sha256).hexdigest()
    assert sign_body("s3", "123", body) == expected


def test_chunk_text():
    assert chunk_text("") == []
    assert chunk_text("hi") == ["hi"]
    long = ("Предложение номер один. " * 80).strip()
    parts = chunk_text(long, limit=200)
    assert all(len(p) <= 200 for p in parts)
    assert " ".join(parts).replace("  ", " ") == long
    no_spaces = "a" * 450
    assert [len(p) for p in chunk_text(no_spaces, limit=200)] == [200, 200, 50]


@pytest.mark.parametrize(
    "exc,kind",
    [
        (igx.TwoFactorRequired("x"), ErrorKind.TWO_FACTOR),
        (igx.BadPassword("x"), ErrorKind.BAD_CREDENTIALS),
        (igx.ChallengeRequired("x"), ErrorKind.CHALLENGE),
        (igx.ChallengeUnknownStep("x"), ErrorKind.CHALLENGE),
        (igx.LoginRequired("x"), ErrorKind.SESSION_EXPIRED),
        (igx.PleaseWaitFewMinutes("x"), ErrorKind.THROTTLED),
        (igx.RateLimitError("x"), ErrorKind.THROTTLED),
        (igx.ProxyAddressIsBlocked("x"), ErrorKind.PROXY),
        (igx.ClientConnectionError("x"), ErrorKind.TRANSIENT),
        (RuntimeError("boom"), ErrorKind.OTHER),
    ],
)
def test_classify_error(exc, kind):
    assert classify_error(exc) is kind


def _msg(id, user_id, text="привет", item_type="text", minutes_ago=1, mine=False):
    return NS(
        id=id,
        user_id=user_id,
        text=text,
        item_type=item_type,
        is_sent_by_viewer=mine,
        timestamp=datetime.now(timezone.utc) - timedelta(minutes=minutes_ago),
    )


def _thread(messages, users=None, is_group=False, tid="900"):
    users = users if users is not None else [NS(pk=111, username="client", full_name="Клиент")]
    return NS(id=tid, pk=tid, users=users, is_group=is_group, messages=messages)


def test_extract_filters_and_order():
    seen = SeenCache()
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=10)
    threads = [
        _thread(
            [
                _msg("m3", 111, "третье", minutes_ago=1),
                _msg("m2", 111, "второе", minutes_ago=2),
                _msg("own", 999, "мой ответ", mine=True),
                _msg("voice", 111, "", item_type="voice_media"),
                _msg("old", 111, "очень старое", minutes_ago=120),
            ]
        ),
        _thread([_msg("g1", 111, "в группе")], users=[NS(pk=1, username="a", full_name=""), NS(pk=2, username="b", full_name="")], tid="901"),
    ]
    result = extract_new_messages(threads, own_id="999", seen=seen, first_poll=True, cutoff=cutoff)
    assert [m.message_id for m in result] == ["m2", "m3"]
    assert result[0].sender_username == "client"
    assert result[0].thread_id == "900"
    # служебные помечены seen сразу, кандидаты ещё нет
    for skipped in ("own", "voice", "old", "g1"):
        assert skipped in seen
    assert "m2" not in seen

    seen.add("m2")
    seen.add("m3")
    again = extract_new_messages(threads, own_id="999", seen=seen, first_poll=False, cutoff=cutoff)
    assert again == []


def test_old_messages_delivered_after_first_poll():
    seen = SeenCache()
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=10)
    thread = _thread([_msg("late", 111, minutes_ago=120)])
    result = extract_new_messages([thread], own_id="999", seen=seen, first_poll=False, cutoff=cutoff)
    assert [m.message_id for m in result] == ["late"]


def test_seen_cache_is_bounded():
    seen = SeenCache(limit=3)
    for i in range(5):
        seen.add(str(i))
    assert len(seen) == 3 and "0" not in seen and "4" in seen
