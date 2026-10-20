# Instagram через логин/пароль: применение патча

Что внутри: новая служба `services/ig-worker` (Python, instagrapi) и правки Next-приложения.
Next теперь только вызывает воркер по HTTP, а сообщения от воркера принимает на `/api/instagram/inbound`.

## 1. Применить файлы

Из корня репозитория:

```bash
unzip -o instagram-userbot-patch.zip -d .
```

Файлы ложатся по своим путям:

```
services/ig-worker/**                         новая служба (README.md внутри)
lib/channels/instagram-client.ts              заменён: тонкий HTTP-клиент к воркеру
lib/server/instagram-processor.ts             новый: обработка входящих (лид, диалог, ИИ, ответ)
lib/server/instagram-inbound-signature.ts     новый: проверка HMAC-подписи от воркера
lib/server/instagram-processor.test.ts        новый: тесты процессора и подписи
app/api/instagram/inbound/route.ts            новый: приём сообщений от воркера
app/api/instagram/connect/route.ts            заменён: теперь реально логинит (раньше всегда 410)
app/api/integrations/status/route.ts          изменён: учитывает provider='userbot'
app/dashboard/[agentId]/integrations/page.tsx изменён: форма логин/пароль/код + предупреждение
.env.example                                  добавлены IG_WORKER_URL, IG_WORKER_SECRET
```

## 2. Удалить мёртвый код

```bash
git rm lib/channels/instagram-handler.ts        # старый обработчик, больше никем не используется
npm uninstall instagram-private-api instagram_mqtt   # прежний Node-клиент заменён воркером
grep -rn "instagram-private-api\|instagram_mqtt\|instagram-handler" --include=*.ts --include=*.tsx . --exclude-dir=node_modules
# команда должна ничего не вернуть
```

OAuth-роуты (`app/api/instagram/oauth/*`, `app/api/webhooks/instagram`, cron `instagram-token-refresh`) НЕ удалять:
они не используются в UI, но удаление отдельная задача.

## 3. Проверки (все должны пройти)

```bash
npx tsc --noEmit
npm run build
node --import tsx --test lib/server/instagram-processor.test.ts
cd services/ig-worker && pip install -r requirements-dev.txt && pytest && cd ../..
```

## 4. Миграция БД

Проверить в Supabase, что `channels.type` допускает `'instagram'`:

```sql
select pg_get_constraintdef(oid) from pg_constraint where conname = 'channels_type_check';
```

Если в определении нет `instagram`, применить `db/migrations/20261004120000_allow_instagram_channels.sql` и
`20261004120001_*` (они уже есть в репозитории).

## 5. Деплой на Railway

1. Новый сервис из этого репозитория, **Root Directory** `services/ig-worker`, реплик 1.
2. Переменные воркера (подробности в `services/ig-worker/README.md`):
   `IG_WORKER_SECRET`, `IG_SESSION_ENCRYPTION_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `NEXT_INBOUND_URL`, `PORT=8000`, при необходимости `IG_PROXY_URL`.
3. В основном Next-сервисе: `IG_WORKER_URL=http://<имя-сервиса-воркера>.railway.internal:8000`
   и тот же `IG_WORKER_SECRET`.
4. Проверка: `GET <воркер>/health` → `{"ok": true, "ready": true}`.

## 6. Ручная проверка после деплоя

1. Интеграции → Instagram → логин/пароль ОТДЕЛЬНОГО аккаунта → «Подключить».
2. Если появилось поле для кода (challenge/2FA): ввести код → статус «Instagram подключён».
3. Написать этому аккаунту из другого: в течение ~40 с + 2–6 с должен прийти ответ ИИ.
4. В БД: `messages.external_message_id` вида `ig_...`, ответ ИИ сохранён с `sender='ai'`.
5. Перезапустить воркер: статус остаётся «подключён» без нового ввода пароля.
6. Отключить: `channels.credentials.session` пропадает, `is_active=false`.

## Известные ограничения

- Обрабатывается только текст (голосовые, фото, истории пропускаются). Групповые чаты игнорируются.
- Входящие приходят с задержкой опроса 20–40 с (push у неофициального API нет).
- Если Instagram запросит подтверждение входа «в приложении» (а не кодом), подтвердите вход в приложении
  Instagram («Это был я») и подключите аккаунт заново.
- Роуты `/api/instagram/*` проверяют только вход пользователя, как и остальные интеграции (проверки владения агентом нет).
- В `/docs/SPEC.md` Instagram указан вне scope: обновить после принятия патча.
