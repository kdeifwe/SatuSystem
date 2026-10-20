from __future__ import annotations

from enum import Enum

from instagrapi import exceptions as igx


class ErrorKind(str, Enum):
    BAD_CREDENTIALS = "bad_credentials"
    TWO_FACTOR = "two_factor"
    CHALLENGE = "challenge"
    SESSION_EXPIRED = "session_expired"
    THROTTLED = "throttled"
    PROXY = "proxy"
    TRANSIENT = "transient"
    OTHER = "other"


MESSAGES: dict[ErrorKind, str] = {
    ErrorKind.BAD_CREDENTIALS: "Неверный логин или пароль Instagram.",
    ErrorKind.TWO_FACTOR: "Instagram требует код двухфакторной аутентификации.",
    ErrorKind.CHALLENGE: (
        "Instagram запросил подтверждение входа. Откройте приложение Instagram, подтвердите "
        "«Это был я» и подключите аккаунт снова."
    ),
    ErrorKind.SESSION_EXPIRED: "Сессия Instagram истекла. Подключите аккаунт заново.",
    ErrorKind.THROTTLED: "Instagram временно ограничил запросы. Пауза 30 минут.",
    ErrorKind.PROXY: "Прокси заблокирован Instagram или недоступен. Проверьте IG_PROXY_URL.",
    ErrorKind.TRANSIENT: "Временная ошибка соединения с Instagram.",
    ErrorKind.OTHER: "Не удалось выполнить запрос к Instagram.",
}


def classify_error(exc: BaseException) -> ErrorKind:
    """Порядок проверок важен: ChallengeRequired наследует ChallengeError и т.д."""
    if isinstance(exc, igx.TwoFactorRequired):
        return ErrorKind.TWO_FACTOR
    if isinstance(exc, (igx.BadPassword, igx.BadCredentials)):
        return ErrorKind.BAD_CREDENTIALS
    if isinstance(exc, igx.ChallengeError):  # включает ChallengeRequired и подтипы
        return ErrorKind.CHALLENGE
    if isinstance(exc, igx.ProxyAddressIsBlocked):
        return ErrorKind.PROXY
    if isinstance(
        exc,
        (igx.LoginRequired, igx.ClientLoginRequired, igx.ReloginAttemptExceeded),
    ):
        return ErrorKind.SESSION_EXPIRED
    if isinstance(
        exc,
        (igx.PleaseWaitFewMinutes, igx.RateLimitError, igx.ClientThrottledError, igx.FeedbackRequired),
    ):
        return ErrorKind.THROTTLED
    if isinstance(exc, (igx.ClientConnectionError, TimeoutError, ConnectionError)):
        return ErrorKind.TRANSIENT
    return ErrorKind.OTHER


def user_message(kind: ErrorKind) -> str:
    return MESSAGES[kind]


class WorkerError(Exception):
    """Ошибка уровня API воркера: превращается в JSON с нужным HTTP-статусом."""

    def __init__(self, message: str, http_status: int = 400, code: str = "error") -> None:
        super().__init__(message)
        self.message = message
        self.http_status = http_status
        self.code = code
