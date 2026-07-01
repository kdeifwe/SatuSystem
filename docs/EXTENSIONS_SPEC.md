# ТЗ: Модуль "Расширения" (Extensions) — для платформы AI-агентов

## 0. Статус документа

Это дополнение к `/docs/SPEC.md`. Кладёшь этот файл рядом как `/docs/EXTENSIONS_SPEC.md`.
Модуль реализуется **внутри уже существующей архитектуры** (Фаза 4 общего плана —
"Сценарии + Рассылки + Расширения"), поэтому агент должен сначала прочитать `SPEC.md`
целиком, а потом этот файл — без этого он не поймёт структуру `agents`, `leads`,
`conversations`, `messages`, `org_members`.

Реализуем 7 расширений из référence-скриншота:

1. Уведомления в Telegram

2. Повторные касания

3. Автопереключение диалогов (AI ⇄ оператор)

4. График работы

5. Запланированные сообщения

6. Задержка сообщений

7. Разделение сообщения на части

Это не косметика поверх UI — каждое расширение меняет поведение AI Orchestrator
(раздел 2 SPEC.md), поэтому ниже не просто "сделай красивые карточки", а точная логика
выполнения, порядок проверок, race conditions и что именно логировать.

---

## 1. Схема БД (миграции, добавляются к схеме из SPEC.md раздел 3)

```
-- ============ НАСТРОЙКИ РАСШИРЕНИЙ ============
-- Одна запись = одно расширение для одного агента. is_active отражается на UI-тоггле
-- "Активно/Неактивно" на карточке.
create table extension_settings (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references agents(id) on delete cascade,
  extension_type text not null check (extension_type in (
    'telegram_notifications',
    'repeat_touches',
    'auto_switch',
    'working_hours',
    'scheduled_messages',
    'message_delay',
    'message_splitting'
  )),
  is_active boolean default false,
  config jsonb not null default '{}',
  updated_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (agent_id, extension_type)
);

alter table extension_settings enable row level security;
create policy "org members manage own org extension settings"
on extension_settings for all
using (
  agent_id in (
    select a.id from agents a
    join org_members om on om.org_id = a.org_id
    where om.user_id = auth.uid()
  )
);

-- ============ TELEGRAM-АККАУНТ ЧЛЕНА КОМАНДЫ (для внутренних уведомлений) ============
-- Отдельный "служебный" бот для уведомлений команды — НЕ путать с клиентским
-- Telegram-каналом из таблицы channels (тот общается с лидами, этот — с твоей командой).
alter table profiles add column telegram_chat_id text;
alter table profiles add column telegram_link_token text;
alter table profiles add column telegram_link_token_expires_at timestamptz;

-- ============ ЛОГ ОТПРАВЛЕННЫХ УВЕДОМЛЕНИЙ (идемпотентность, антиспам) ============
create table notification_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete cascade,
  agent_id uuid references agents(id),
  lead_id uuid references leads(id),
  event_type text not null check (event_type in ('new_message','help_request','custom_condition')),
  custom_condition_key text, -- например 'status_changed_to_won'
  recipient_profile_id uuid references profiles(id),
  payload jsonb,
  sent_at timestamptz default now(),
  delivery_status text default 'sent' check (delivery_status in ('sent','failed'))
);
create index notification_log_dedup_idx on notification_log(lead_id, event_type, custom_condition_key, sent_at);

-- ============ ПОВТОРНЫЕ КАСАНИЯ: состояние по каждому лиду ============
create table lead_repeat_touch_state (
  lead_id uuid primary key references leads(id) on delete cascade,
  attempts_sent int default 0,
  last_attempt_at timestamptz,
  last_inbound_at timestamptz, -- последний раз, когда лид сам что-то написал
  updated_at timestamptz default now()
);

-- ============ АВТОПЕРЕКЛЮЧЕНИЕ: состояние паузы AI по лиду ============
alter table leads add column ai_paused boolean default false;
alter table leads add column ai_paused_at timestamptz;
alter table leads add column ai_paused_reason text check (
  ai_paused_reason in ('operator_takeover','working_hours','manual') or ai_paused_reason is null
);
alter table leads add column last_operator_message_at timestamptz;

-- ============ ЗАПЛАНИРОВАННЫЕ СООБЩЕНИЯ ============
-- Используется и инструментом scheduleMessage() из SPEC.md раздел 5, и расширением
-- "Запланированные сообщения", и расширением "График работы" (режим queue_for_open).
create table scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete cascade,
  lead_id uuid references leads(id) on delete cascade,
  conversation_id uuid references conversations(id),
  content text not null,
  send_at timestamptz not null,
  source text not null check (source in ('ai_tool_call','operator_manual','working_hours_queue')),
  status text default 'pending' check (status in ('pending','sent','failed','cancelled')),
  attempts int default 0,
  last_error text,
  created_by uuid references profiles(id), -- null если создано AI
  created_at timestamptz default now(),
  sent_at_actual timestamptz
);
create index scheduled_messages_due_idx on scheduled_messages(send_at) where status = 'pending';

alter table scheduled_messages enable row level security;
create policy "org members manage own org scheduled messages"
on scheduled_messages for all
using (org_id in (select org_id from org_members where user_id = auth.uid()));

-- ============ ЗАДЕРЖКА / РАЗБИВКА СООБЩЕНИЙ ============
-- Доп. данных в БД не нужно — это политика времени выполнения, конфиг лежит в
-- extension_settings.config. Но полезно логировать фактическую задержку для отладки:
alter table messages add column send_delay_ms int;
alter table messages add column split_group_id uuid; -- объединяет части одного "логического" ответа AI
alter table messages add column split_part_index int;
```

**Почему так, а не одной jsonb-колонкой на агенте:** отдельная таблица `extension_settings`
даёт нормальный UNIQUE constraint, RLS и историю `updated_at/updated_by` без блокировки
всей строки `agents` при каждом тоггле — это часто меняемые настройки, агент не должен
конфликтовать с RLS-политиками самого агента.

---

## 2. Точная логика выполнения (порядок проверок в AI Orchestrator)

Это меняет шаг 1–7 из SPEC.md раздел 2. Воркер при получении входящего сообщения
**обязан** проходить эти проверки строго по порядку — порядок важен, не переставлять:

```
ВХОДЯЩЕЕ СООБЩЕНИЕ ОТ ЛИДА
│
├─ 0. Идемпотентность: insert в messages с external_message_id (unique constraint).
│     Если конфликт — выходим, ничего не делаем (это ретрай вебхука).
│
├─ 1. Обновить lead_repeat_touch_state: last_inbound_at = now(), attempts_sent = 0.
│     (Лид написал сам — счётчик "повторных касаний" сбрасывается.)
│
├─ 2. Проверить auto_switch (если активно для agent_id):
│     если leads.ai_paused = true → НЕ генерировать ответ AI.
│       Если в конфиге auto_switch.notify_on_paused_message = true и активно
│       telegram_notifications с событием 'new_message' → отправить уведомление
│       оператору (см. раздел 3.1) и остановиться.
│     иначе → продолжить.
│
├─ 3. Проверить working_hours (если активно):
│     вычислить текущее время в org.timezone (или override из конфига расширения).
│     если ВНЕ рабочего окна:
│       behavior = 'silent'      → просто сохранить сообщение, ничего не отправлять.
│       behavior = 'auto_reply'  → отправить заранее заданный текст
│                                   ("Мы работаем с 9 до 18, ответим в начале дня"),
│                                   ОДИН раз на лида за вне-рабочее окно (не спамить
│                                   при каждом сообщении — проверять, не отправляли
│                                   ли уже за текущий "вне-рабочий" интервал, см. 3.4).
│       behavior = 'queue_for_open' → сгенерировать AI-ответ как обычно (шаги 4-6),
│                                   но НЕ отправлять сразу, а создать запись в
│                                   scheduled_messages с send_at = ближайшее открытие
│                                   и source='working_hours_queue'.
│       behavior = 'notify_operator' → не отвечать, отправить Telegram-уведомление
│                                   команде о сообщении вне часов работы.
│     если ВНУТРИ рабочего окна → продолжить как обычно.
│
├─ 4. Генерация ответа AI: RAG (searchKnowledgeBase) + Gemini function calling,
│     как в SPEC.md раздел 2, шаги 1-5.
│
│     Если AI вызвал redirectToOperator → выставить leads.ai_enabled=false,
│     и если активно telegram_notifications с событием 'help_request' →
│     уведомление (раздел 3.1).
│
├─ 5. Применить message_splitting (если активно):
│     разбить итоговый текст ответа на части по правилам конфига (раздел 3.7).
│     Если неактивно — "одна часть" = весь текст.
│
├─ 6. Применить message_delay (если активно) к КАЖДОЙ части по очереди:
│     вычислить задержку (раздел 3.6), показать "печатает..." в канале (если API
│     поддерживает), подождать, затем отправить часть, сохранить в messages с
│     split_group_id (одинаковый для всех частей одного ответа) и split_part_index.
│     Между частями — отдельная пауза (конфиг message_splitting.delay_between_parts).
│
├─ 7. После отправки — обновить lead_repeat_touch_state.last_attempt_at НЕ трогаем
│     (это касается исходящих от AI/оператора, см. раздел 3.2), но если это был
│     ответ AI/оператор — это и есть точка отсчёта для repeat_touches следующего цикла.
│
└─ 8. Логирование как обычно в ai_call_logs (без изменений из SPEC.md).
```

Отдельно, **вне** входящего потока — реакция на исходящее сообщение оператора:

```
ВСТАВКА В messages С sender = 'operator'
│
└─ Если активно auto_switch для agent_id этого лида:
     UPDATE leads SET ai_paused = true, ai_paused_at = now(),
                       ai_paused_reason = 'operator_takeover',
                       last_operator_message_at = now()
     WHERE id = lead_id;
   (Реализовать как Postgres trigger AFTER INSERT ON messages, а не в коде воркера —
    иначе при прямой записи из других мест пауза не сработает. Триггер — источник правды.)
```

---

## 3. Логика и конфиг каждого расширения

### 3.1 Уведомления в Telegram (`telegram_notifications`)

**Зачем:** команда получает в личный Telegram пуш о событиях, не открывая дашборд.

**Конфиг (jsonb):**

```
{
  "recipients": ["profile_id_1", "profile_id_2"],
  "events": {
    "new_message": { "enabled": true, "only_if_ai_paused": true },
    "help_request": { "enabled": true },
    "custom_conditions": [
      { "key": "status_changed_to_won", "trigger": "status_change", "value": "won",
        "label": "Сделка закрыта", "template": "🎉 {{lead.name}} — сделка закрыта!" },
      { "key": "status_changed_to_lost", "trigger": "status_change", "value": "lost",
        "label": "Сделка потеряна", "template": "❌ {{lead.name}} — сделка потеряна" }
    ]
  }
}
```

**Подключение аккаунта (обязательно реализовать — без этого расширение нерабочее):**

1. Отдельный служебный Telegram-бот (BotFather), токен в `.env` /
`TELEGRAM_NOTIFICATIONS_BOT_TOKEN` — НЕ тот бот, что общается с лидами.

2. UI: кнопка "Подключить Telegram" в настройках расширения → генерируем
`profiles.telegram_link_token` (случайный, 10 минут жизни) → показываем
диплинк `https://t.me/?start=`.

3. Webhook служебного бота на `/start `: найти profile по токену
(проверить `telegram_link_token_expires_at > now()`), сохранить
`telegram_chat_id = update.message.chat.id`, обнулить токен. Ответить
пользователю "Уведомления подключены ✅".

4. Если профиль не подключил Telegram, а выбран как recipient — в UI показывать
предупреждение "Этот участник ещё не подключил Telegram" вместо тихого провала.

**Отправка события:**

- `new_message`: триггерится в шаге 2 оркестратора (см. раздел 2), только если
`ai_paused=true` (предполагается: уведомлять, когда диалог "на операторе" и
пришло новое сообщение, иначе при каждом обычном AI-ответе будет спам). Если
`only_if_ai_paused=false` — слать при каждом входящем независимо от паузы.

- `help_request`: триггерится сразу после вызова инструмента `redirectToOperator`.

- `custom_conditions` / `status_change`: реализовать Postgres trigger
`AFTER UPDATE OF status ON leads` — сравнить `OLD.status` и `NEW.status`,
если есть активный custom_condition с `trigger='status_change'` и
`value = NEW.status` для агента этого лида → поставить событие в очередь
уведомлений (через notify/pg_notify или запись в отдельную outbox-таблицу,
не обязательно создавать новую — можно использовать pg_cron polling раз в
10-15 секунд по `notification_log` отсутствию + триггерному маркеру, либо
Supabase Realtime + Edge Function слушатель — выбери то, что уже есть в
стеке проекта, не плоди новую инфраструктуру).

- Перед отправкой — проверить `notification_log`: не отправляли ли уже это же
`(lead_id, event_type, custom_condition_key)` за последние N минут (защита от
дублей при ретраях/гонках). После отправки — записать в `notification_log`.

- Формат сообщения — рендерить `template` с переменными `{{lead.name}}`,
`{{lead.status}}`, `{{lead.tags}}` и т.п. (простая замена строк, не eval).

---

### 3.2 Повторные касания (`repeat_touches`)

**Зачем:** лид замолчал после ответа AI — система сама напоминает о себе, чтобы не
терять лида, без участия оператора.

**Конфиг:**

```
{
  "silence_hours": 2,
  "max_attempts": 3,
  "stop_statuses": ["won", "lost", "closed"],
  "stop_if_ai_disabled": true,
  "message_mode": "ai_generated",
  "fixed_templates": [
    "Кажется, вы про меня забыли... Обещаю не обижаться, если вернетесь!",
    "Просто чтобы не потерять нить разговора — вы ещё думаете над предложением?",
    "Последнее напоминание с моей стороны 🙂 Если актуально — просто напишите."
  ]
}
```

**Воркер (cron, раз в 5–15 минут, реализовать через pg_cron + Edge Function или
Trigger.dev — что уже выбрано в проекте для фоновых задач):**

```
select l.id, l.org_id, l.agent_id /* через conversations->agent_id */, rts.attempts_sent
from leads l
join lead_repeat_touch_state rts on rts.lead_id = l.id
where l.ai_enabled = true
  and l.ai_paused = false
  and l.status not in ()
  and rts.last_attempt_at is null  -- ещё ни разу не трогали в этом "молчании"
       or rts.last_attempt_at  hours'
  and rts.attempts_sent 
  and exists (
    select 1 from conversations c join messages m on m.conversation_id = c.id
    where c.lead_id = l.id and m.sender in ('ai','operator')
    -- последнее сообщение в диалоге было ОТ нас, а не от лида
    order by m.created_at desc limit 1
  )
for update skip locked; -- защита от двойного запуска воркера
```

Важно: условие "последнее сообщение было от нас" обязательно проверять — иначе
будет догонять лида, который только что сам написал, но воркер ещё не успел
обработать (race condition с шагом 1 из раздела 2). `last_inbound_at` в
`lead_repeat_touch_state` — дополнительная подушка безопасности: если
`last_inbound_at > last_attempt_at` — пропустить, лид уже ответил.

**Генерация сообщения:**

- `message_mode = "fixed_templates"` → берём `fixed_templates[attempts_sent % length]`.

- `message_mode = "ai_generated"` → вызываем Gemini с отдельным system-промптом
"напиши короткое естественное follow-up-сообщение для лида, который замолчал
после {{attempts_sent + 1}}-й попытки, контекст диалога: ..." — переиспользовать
существующий пайплайн вызова LLM, залогировать в `ai_call_logs`.

- Отправить через тот же канал, что и был у лида (`channels.type`).

- После отправки: `attempts_sent += 1`, `last_attempt_at = now()`, записать
сообщение в `messages` с `sender='ai'`, прогнать через `message_delay`/
`message_splitting`, если активны (то есть повторное касание — такое же
сообщение AI, проходит ту же финальную обработку, что и обычный ответ).

- На `max_attempts` достигнут → ничего не делаем дальше, но НЕ меняем статус
лида автоматически (это решение оператора, не системы) — можно опционально
вызвать `add_lead_note` с текстом "Повторные касания исчерпаны (3/3),
лид не ответил".

---

### 3.3 Автопереключение диалогов (`auto_switch`)

**Зачем:** если оператор сам отвечает в чате, AI должен заткнуться, а не дублировать
или противоречить оператору; когда оператор закончил — AI снова берёт диалог.

**Конфиг:**

```
{
  "resume_mode": "inactivity_timeout",
  "resume_after_minutes": 30,
  "notify_on_paused_message": true
}
```

**Логика паузы** — см. триггер в разделе 2 ("ВСТАВКА В messages С sender = 'operator'").

**Логика возобновления** (cron, раз в 1-5 минут):

```
update leads
set ai_paused = false, ai_paused_reason = null
where ai_paused = true
  and ai_paused_reason = 'operator_takeover'
  and last_operator_message_at  minutes';
```

Плюс — **ручная кнопка** "Включить AI обратно" в карточке лида в UI (вызывает тот
же update немедленно), потому что 30 минут таймаута не всегда подходящий UX —
оператор должен иметь explicit override, не дожидаясь таймера. Это обязательная
часть, не опция "сделаем потом".

Пока `ai_paused = true` — AI не генерирует ответы (проверка в шаге 2 оркестратора),
но входящие сообщения лида всё равно сохраняются в `messages` и видны оператору
в реальном времени через Supabase Realtime.

---

### 3.4 График работы (`working_hours`)

**Конфиг:**

```
{
  "timezone_override": null,
  "schedule": {
    "mon": [{"start": "09:00", "end": "18:00"}],
    "tue": [{"start": "09:00", "end": "18:00"}],
    "wed": [{"start": "09:00", "end": "18:00"}],
    "thu": [{"start": "09:00", "end": "18:00"}],
    "fri": [{"start": "09:00", "end": "18:00"}],
    "sat": [],
    "sun": []
  },
  "holidays": ["2026-01-01", "2026-03-08"],
  "behavior_outside_hours": "auto_reply",
  "auto_reply_text": "Спасибо за сообщение! Мы работаем с 9:00 до 18:00 по будням, ответим в начале рабочего дня.",
  "auto_reply_once_per_window": true
}
```

`schedule` поддерживает несколько интервалов в день (например, обед-перерыв) —
массив, не объект.

**Проверка "сейчас рабочее время":** вычислить день недели и время в нужной
timezone, проверить, не входит ли текущая дата в `holidays`, затем — попадает ли
текущее время в один из интервалов сегодняшнего дня.

**`auto_reply_once_per_window`:** чтобы не слать "мы работаем с 9 до 18" на каждое
сообщение лида ночью — проверять, не отправляли ли уже auto_reply этому лиду с
момента закрытия (последнее сообщение с `sender='system'` и пометкой
`metadata.type='working_hours_auto_reply'` после последнего момента открытия) —
проще всего хранить `leads.attributes.last_working_hours_notice_at` и сверять с
последней границей "рабочее → нерабочее".

**`queue_for_open`:** при создании `scheduled_messages` с `source='working_hours_queue'`
вычислить `send_at` = ближайший следующий момент входа в рабочее окно (с учётом
holidays). Worker из раздела 3.5 отправит его как обычное сообщение.

Этот конфиг также должен **блокировать** работу `repeat_touches` вне рабочих часов
(повторные касания не должны прилетать лиду в 3 ночи) — воркер `repeat_touches`
обязан проверять `working_hours`, если оно активно для того же агента, прежде
чем отправлять.

---

### 3.5 Запланированные сообщения (`scheduled_messages` extension)

Это UI-надстройка над таблицей `scheduled_messages`, которая уже используется
инструментом `scheduleMessage()` (SPEC.md раздел 5). Расширение в карточке
"Включить/Выключить" контролирует **только** разрешение ли AI вызывать
`scheduleMessage` автономно (тот случай, когда клиент пишет "напишите мне позже") —
если выключено, инструмент `scheduleMessage` должен быть исключён из function
calling schema, переданной в Gemini для этого агента.

**Конфиг:**

```
{
  "allow_ai_initiated": true,
  "max_delay_days": 14
}
```

**Воркер (cron, каждую минуту — это времячувствительная штука):**

```
select * from scheduled_messages
where status = 'pending' and send_at <= now()
order by send_at asc
for update skip locked
limit 100;
```

Для каждой: отправить как обычное сообщение в канал лида, установить
`status='sent'`, `sent_at_actual=now()`, плюс пройти через проверку
`message_splitting`/`message_delay`, если активны для этого агента.

На ошибку: increment `attempts`, сохранить ошибку в `last_error`, поставить на
retry через 5 мин (update `send_at = now() + '5 min'`). Если `attempts > 5` —
`status='failed'`, не переправлять.

---

### 3.6 Задержка сообщений (`message_delay`)

**Зачем:** AI ответит слишком мгновенно — лид не поверит, что это реальный человек,
а не бот. Небольшая задержка имитирует печать + время на обдумывание.

**Конфиг:**

```
{
  "enabled": true,
  "min_delay_ms": 500,
  "max_delay_ms": 3000,
  "scale_with_length": true,
  "scale_factor": 10 -- N мс на символ текста
}
```

**Расчёт:** если `scale_with_length=true`, то
`delay_ms = max(min_delay_ms, min(max_delay_ms, message_length * scale_factor))`.

Иначе — случайное значение в `[min_delay_ms, max_delay_ms]`.

**Реализация — ВАЖНО:** задержка **НЕ** должна быть синхронной `sleep()` в обработчике
вебхука (это блокирует), а через scheduler / queue:
1. Вычислить `send_at_actual = now() + delay_ms`.
2. Создать запись в `scheduled_messages` с `source='ai_tool_call'` / `source='operator_manual'`.
3. Дальше воркер из раздела 3.5 пошлёт её в нужный момент.

Но можно оптимизировать: если `delay_ms < 10 сек` — можно синхронно ждать
(это не блокирует webhook для других входящих). Если больше — в очередь.

Метаданные в `messages`: `send_delay_ms = фактическая_задержка`.

---

### 3.7 Разделение сообщения на части (`message_splitting`)

**Зачем:** длинный AI-ответ (200+ символов) лучше приходит несколькими сообщениями,
чем одной простынёй — это выглядит естественнее и усиливает ощущение диалога.

**Конфиг:**

```
{
  "enabled": true,
  "max_chars_per_message": 200,
  "split_on_paragraphs": true,
  "delay_between_parts_ms": 800
}
```

**Алгоритм:**

1. Если `split_on_paragraphs=true` — разбить по `\n\n` (абзацам), потом доконцевать,
если абзац > `max_chars_per_message`, разбить его же по `\n` (строкам),
потом по `. ` (предложениям), потом прямо посередине слова, но стараясь не разрывать
слова.

2. Если `split_on_paragraphs=false` — просто разбить по `max_chars_per_message`,
не вникая в структуру.

3. Каждой части: `split_group_id = guid`, `split_part_index = 0, 1, 2, ...`.

4. Между отправками частей в канал — задержка `delay_between_parts_ms`.

---

## 4. UI: Страница расширений

**Маршрут:** `/dashboard/[agentId]/extensions` (аналогично `knowledge`, `scenarios`,
`integrations`).

**Макет:**

- Заголовок "Расширения для [имя агента]"
- 7 карточек в сетке (2-3 колонны в зависимости от экрана)
- На каждой карточке:
  - Иконка (emoji или icon из наличного набора)
  - Название расширения
  - Краткое описание (1-2 строки)
  - Toggle "Активно/Неактивно" (оптимистичный апдейт, сохраняет в `extension_settings.is_active`)
  - Кнопка "⚙️ Настроить" (открывает Drawer/Modal с формой конфига)

**Drawer с конфигом:**

- Форма с полями по конфигу расширения (раздел 3)
- Для `telegram_notifications`: кнопка "Подключить Telegram" (если не подключен профиль) +
список recipients (мультиселект из members)
- Для прочих: стандартные input/textarea/select
- Кнопка "Сохранить" (PATCH к `extension_settings`)
- Кнопка "Отмена"

**State management:** React Context / Zustand для `extension_settings` по агенту,
подписка на Supabase Realtime для live-updates (если другой пользователь меняет
конфиг одновременно).

---

## 5. Что НЕ делать: ограничения (обязательны!)

1. **Не блокируй webhook обработчик синхронными паузами (`sleep`, `Thread.sleep`)**
   — используй scheduler/queue для всех задержек > 5 сек.

2. **Не вызывай LLM дважды для одного ответа** — переиспользуй результат
   Gemini function calling из шага 4 (раздел 2) для всех downstream-шагов.

3. **Не логируй одно и то же событие дважды в `notification_log`** —
   проверяй dedup перед каждой отправкой.

4. **Не меняй порядок проверок в разделе 2** — это чувствительная последовательность,
   она определена так для защиты от race conditions.

5. **Не создавай новую инфраструктуру для асинхронных задач** —
   используй то, что уже выбрано в проекте (pg_cron + Edge Function,
   Trigger.dev, или что там).

6. **Не допускай двойные отправки** — используй `for update skip locked` в кронах,
   UNIQUE constraint в таблицах, идемпотентные ключи в message log.

7. **Не оставляй заглушек в Telegram-подключении** — полный флоу от кнопки
   "Подключить" до webhook `/start` и проверки токена.

8. **Не полагайся на клиентский JavaScript для критичной логики** — все проверки
   (RLS, state transitions) должны быть в PostgreSQL / Backend.

---

## 6. Чек-лист: Что проверить перед "готово"

- [ ] Все 8 таблиц созданы с нужными колонками, индексами и RLS-политиками

- [ ] Миграции идентичны в dev и prod (или стратегия версионирования выбрана)

- [ ] Все 7 расширений отображаются в UI, тогглы и drawer'ы открываются

- [ ] Toggle включения/выключения расширения сохраняется в БД и отражается на UI
  при перезагрузке

- [ ] Одно входящее сообщение вызывает ровно одну AI-генерацию, не дважды

- [ ] Повторное касание отправляется ТОЛЬКО если прошло `silence_hours` БЕЗ
  входящих и последнее исходящее было от нас

- [ ] Проверка `silence_hours` не срабатывает в 3 ночи,
  если активно `working_hours` (repeat_touches блокируется вне часов)

- [ ] Сообщение вне рабочих часов с `behavior='auto_reply'` — автоответ приходит
  ровно один раз, не на каждое входящее

- [ ] При `queue_for_open` AI генерирует ответ, но отправляется в момент открытия
  (проверить по `sent_at_actual` в `scheduled_messages`)

- [ ] Оператор пишет в чат → `ai_paused = true` (триггер Postgres отработал)

- [ ] Входящее сообщение лида при паузе AI → Telegram-уведомление команде
  (если `notify_on_paused_message = true`)

- [ ] `resume_after_minutes` таймер работает (через 30 мин инактивности оператора →
  `ai_paused = false`)

- [ ] Ручная кнопка "Включить AI обратно" работает мгновенно, без таймера

- [ ] Длинный ответ (>200 символов) с `max_chars_per_message=200` разбивается на
  N сообщений с паузами между ними

- [ ] `message_delay` между получением и отправкой — в диапазоне `[min, max]` мс

- [ ] Повторное касание проходит через `message_splitting`/`message_delay`
  (то есть follow-up тоже может быть разбит на части с задержками)

- [ ] Достигнут `max_attempts` для повторных касаний → касания прекращаются, лиду не пишут бесконечно

- [ ] Оператор написал в чат лиду вручную → AI замолкает (`ai_paused=true`),
новые сообщения лида сохраняются, но AI не отвечает

- [ ] Через `resume_after_minutes` без активности оператора → AI снова отвечает
автоматически

- [ ] Ручная кнопка "Включить AI обратно" работает мгновенно, не дожидаясь таймера

- [ ] Сообщение вне рабочих часов → автоответ отправляется один раз, не на
каждое сообщение подряд

- [ ] Тест `queue_for_open`: сообщение вне часов → ответ AI реально уходит
лиду в момент открытия, не раньше

- [ ] `scheduleMessage()` от AI создаёт запись, она реально уходит в указанное
время (тест с разницей в 2-3 минуты, не ждать 14 дней)

- [ ] При выключенном `allow_ai_initiated` AI физически не может вызвать
`scheduleMessage` (инструмент не передаётся в Gemini schema)

- [ ] Длинный ответ AI (>200 символов) с включённым splitting реально приходит
несколькими сообщениями с паузами, не разрывая предложения

- [ ] `message_delay` — замерить реальное время между получением сообщения и
ответом, убедиться, что оно в диапазоне `min/max + scale_with_length`

- [ ] Параллельный запуск воркера `repeat_touches` дважды одновременно
(искусственно, в тесте) — не создаёт дублирующихся сообщений лиду

- [ ] Все новые таблицы имеют RLS, проверено попыткой прочитать чужой `org_id`

---

## 7. Kickoff-промпт для кодинг-агента (Claude Haiku 4.5 / Gemini в VS Code)

Скопируй как сообщение агенту (положив этот файл в репозиторий рядом с SPEC.md):

```
Ты продолжаешь работу над проектом из /docs/SPEC.md. Сейчас реализуем модуль
"Расширения" (Extensions) — он описан целиком в /docs/EXTENSIONS_SPEC.md.

Сначала прочитай ОБА файла полностью: /docs/SPEC.md (общая архитектура, схема БД,
AI Orchestrator, инструменты агента) и /docs/EXTENSIONS_SPEC.md (это расширение).
Не начинай писать код, пока не прочитал оба целиком.

Это БОЕВАЯ реализация, не MVP и не заглушка. Нужно реализовать все 7 расширений
из раздела 0 EXTENSIONS_SPEC.md полностью, со всей логикой из раздела 2 и 3 —
включая race condition защиту (for update skip locked), идемпотентность уведомлений,
неблокирующие задержки через очередь/таск-раннер (НЕ sleep()), и Postgres-триггеры
там, где это явно указано (пауза AI при сообщении оператора, уведомления на смену
статуса).

Порядок работы:
1. Миграции из раздела 1 EXTENSIONS_SPEC.md — все таблицы, колонки, индексы, RLS.
   Покажи мне список миграций и подожди подтверждения перед применением.
2. Изменения в AI Orchestrator согласно разделу 2 — встрой проверки working_hours,
   auto_switch ДО генерации ответа, и message_splitting/message_delay ПОСЛЕ
   генерации, перед отправкой. Не меняй порядок шагов.
3. Воркеры: repeat_touches (cron), scheduled_messages (cron, каждую минуту),
   auto_switch resume (cron). Используй тот фоновый механизм, что уже выбран в
   проекте по SPEC.md раздел 1 (Supabase Edge Functions + pg_cron либо Trigger.dev) —
   не вводи новую инфраструктуру очередей без необходимости.
4. Telegram-бот для внутренних уведомлений (раздел 3.1) — отдельный от
   клиентского канала. Реализуй полный флоу подключения аккаунта через
   /start , не оставляй заглушку.
5. UI страницы /dashboard/extensions согласно разделу 4 — 7 карточек, тогглы,
   drawer с конфигом, оптимистичные апдейты.
6. Прогони чек-лист из раздела 6 EXTENSIONS_SPEC.md и покажи мне результат по
   каждому пункту — что проверено и как.

Жёсткие правила (повторяю из SPEC.md, они действуют и здесь):
- RLS на каждой новой таблице с org_id/agent_id/lead_id — в той же миграции,
  где создаётся таблица.
- Секреты (токен служебного Telegram-бота и т.д.) — только в .env/Supabase Vault.
- Каждый вызов LLM (включая AI-генерацию follow-up в repeat_touches) логируется
  в ai_call_logs.
- Не блокируй обработчик webhook синхронными паузами — используй раздел 5
  "Не делай" из EXTENSIONS_SPEC.md как обязательный список ограничений.

Не сокращай функциональность ни одного из 7 расширений и не упрощай логику
"для скорости" — весь раздел 3 EXTENSIONS_SPEC.md обязателен целиком, это не
список идей на выбор, а спецификация поведения.

Начни с шага 1 — выведи список миграций и подожди подтверждения.
```
