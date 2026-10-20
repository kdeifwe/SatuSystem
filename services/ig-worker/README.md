# ig-worker

Отдельная служба для подключения Instagram через вход по логину/паролю (библиотека `instagrapi`).
Next-приложение с ней общается по HTTP, Instagram-сессии хранятся в Supabase в зашифрованном виде.

> **Неофициальное подключение.** Instagram может ограничить или заблокировать аккаунт.
> Используйте отдельный аккаунт, не основной. Не используйте для рассылок.

```
Next ── Bearer IG_WORKER_SECRET ──> ig-worker: /login /verify /send /status /logout
ig-worker ── опрос директа 20–40 с ──> Instagram
ig-worker ── POST + HMAC ──> Next /api/instagram/inbound ──> ИИ ──> /send
```

## Переменные окружения

| Переменная | Обяз. | Описание |
|---|---|---|
| `IG_WORKER_SECRET` | да | Общий секрет Next ↔ воркер (длинная случайная строка) |
| `IG_SESSION_ENCRYPTION_KEY` | да | Fernet-ключ для шифрования сессий |
| `SUPABASE_URL` | да | URL проекта |
| `SUPABASE_SERVICE_ROLE_KEY` | да | service role key |
| `NEXT_INBOUND_URL` | да | Куда слать входящие: `http://<next>.railway.internal:3000/api/instagram/inbound` или публичный https |
| `PORT` | нет | По умолчанию 8000 (для приватной сети Railway задайте явно, например `8000`) |
| `IG_PROXY_URL` | нет | `http://user:pass@host:port`, желательно резидентный |
| `IG_POLL_MIN_SEC` / `IG_POLL_MAX_SEC` | нет | Интервал опроса, 20 / 40 |
| `IG_POLL_PENDING` | нет | Опрашивать «запросы на переписку», `true` |
| `IG_BACKFILL_MINUTES` | нет | После рестарта отвечать только на сообщения не старше N минут, 10 |
| `IG_MAX_SENDS_PER_HOUR` | нет | Лимит отправки на аккаунт, 30 |
| `IG_LOCALE`, `IG_TIMEZONE_OFFSET_SEC` | нет | `ru_RU`, `18000` (Asia/Almaty) |

Сгенерировать ключ шифрования и секрет:

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"   # IG_SESSION_ENCRYPTION_KEY
python -c "import secrets; print(secrets.token_urlsafe(48))"                                 # IG_WORKER_SECRET
```

**Не теряйте `IG_SESSION_ENCRYPTION_KEY`**: без него сохранённые сессии не расшифровать (придётся подключать аккаунт заново).

## Деплой на Railway

1. New Service → GitHub repo → **Root Directory:** `services/ig-worker` (подхватится `Dockerfile` и `railway.json`).
2. Variables: все обязательные из таблицы + `PORT=8000`.
3. Settings → **Replicas = 1** (опрос и сессии живут в памяти, несколько реплик будут отвечать дважды).
4. В основном Next-сервисе добавьте `IG_WORKER_URL=http://<имя-сервиса>.railway.internal:8000` и тот же `IG_WORKER_SECRET`.
5. Проверка: `GET /health` → `{"ok": true, "ready": true, ...}`.

## Запуск локально

```bash
cd services/ig-worker
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
pytest                                   # тесты без сети
export $(grep -v '^#' .env.example | xargs)   # заполните значения!
uvicorn app.main:create_production_app --factory --port 8000
```

## API (все, кроме /health, требуют `Authorization: Bearer $IG_WORKER_SECRET`)

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| POST | `/login` | `{channel_id, username, password}` | `{status, username, last_error, challenge_type}` |
| POST | `/verify` | `{channel_id, code}` | то же |
| POST | `/send` | `{channel_id, thread_id, text}` | `{ok, parts}` |
| GET | `/status/{channel_id}` | | то же, что `/login` |
| POST | `/logout/{channel_id}` | | `{status: "disconnected"}` |
| GET | `/health` | | без авторизации |

Статусы: `connecting`, `connected`, `challenge` (код с почты/SMS), `2fa` (код 2FA), `error`, `disconnected`.

## Как это защищает аккаунт

- Пароль не пишется ни в БД, ни в логи (живёт в памяти только пока ждём код 2FA).
- Вход выполняется один раз, дальше используется сохранённая сессия и те же device-идентификаторы.
- При истёкшей сессии воркер НЕ перелогинивается в цикле: статус `error`, пользователь подключает аккаунт заново.
- Ограничение Instagram (`PleaseWaitFewMinutes` и т.п.) → пауза 30 минут.
- Лимит отправки в час на аккаунт, небольшие случайные паузы, случайный интервал опроса.
- Групповые чаты игнорируются, нетекстовые сообщения (голос, фото) пока пропускаются.

## Если не подключается

- **Сразу `challenge` или ошибка входа на Railway.** IP дата-центра Instagram не любит. Задайте `IG_PROXY_URL` (резидентный прокси из той же страны, что и аккаунт) и подтвердите вход в приложении Instagram («Это был я»).
- **`Не удалось расшифровать сессию`.** Изменился `IG_SESSION_ENCRYPTION_KEY`. Подключите аккаунт заново.
- **Сообщения приходят, ответа нет.** Проверьте логи Next (`/api/instagram/inbound`) и что `NEXT_INBOUND_URL` доступен из воркера.
- **Бот отвечает на старые сообщения после рестарта.** Уменьшите `IG_BACKFILL_MINUTES`.
