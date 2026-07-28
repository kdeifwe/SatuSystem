import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

const AUTH_HEADER = 'authorization';
const BOT_TOKEN = process.env.TELEGRAM_NOTIFICATIONS_BOT_TOKEN ?? '';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatTemplate(template: string, payload: Record<string, unknown>) {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, key: string) => {
    const value = payload[key.trim()];
    return value !== null && value !== undefined ? String(value) : '—';
  });
}

function renderMessage(record: any): string {
  const eventType = String(record.event_type || '');
  const payload = record.payload || {};
  const dashboardUrl = `${APP_URL}/dashboard`;

  switch (eventType) {
    case 'operator_needed':
      return `
🆘 <b>Нужен оператор</b>
👤 Лид: ${escapeHtml(String(payload.lead_name ?? '—'))} (${escapeHtml(String(payload.channel ?? '—'))})
💬 Причина: ${escapeHtml(String(payload.reason ?? '—'))}
🔗 <a href="${dashboardUrl}/leads/${payload.lead_id}">Открыть диалог</a>
      `.trim();

    case 'channel_down':
      return `
⚠️ <b>Канал недоступен</b>
📡 Канал: ${escapeHtml(String(payload.channel_type ?? '—'))} (${escapeHtml(String(payload.channel_name ?? '—'))})
❌ Ошибка: ${escapeHtml(String(payload.error_message ?? '—'))}
⏰ Время: ${new Date(payload.time as string).toLocaleString('ru-RU')}
→ Проверить настройки канала
      `.trim();

    case 'ai_silent':
      return `
⏳ <b>AI не отвечает</b>
👤 Лид: ${escapeHtml(String(payload.lead_name ?? '—'))}
💬 Последнее сообщение: "${escapeHtml(String(payload.last_message_preview ?? '—'))}"
⏰ Ждёт ответа: ${payload.waiting_minutes ?? '—'} мин
→ Ответить вручную или проверить статус AI
      `.trim();

    case 'deal_won':
      return `
🎉 <b>Сделка закрыта!</b>
👤 ${escapeHtml(String(payload.lead_name ?? '—'))}
📱 Канал: ${escapeHtml(String(payload.channel_type ?? '—'))}
🏷️ Теги: ${escapeHtml(String(payload.lead_tags ?? '—'))}
💼 Ответственный: ${escapeHtml(String(payload.assigned_to_name ?? '—'))}
🔗 <a href="${dashboardUrl}/leads/${payload.lead_id}">Открыть карточку</a>
      `.trim();

    case 'deal_lost':
      return `
❌ <b>Лид потерян</b>
👤 ${escapeHtml(String(payload.lead_name ?? '—'))}
💬 Последнее сообщение: "${escapeHtml(String(payload.last_message_preview ?? '—'))}"
📅 Дней в работе: ${payload.days_since_created ?? '—'}
→ Можно попробовать реактивацию через рассылку
      `.trim();

    case 'new_lead':
      return `
🆕 <b>Новый лид</b>
👤 ${escapeHtml(String(payload.lead_name ?? 'Без имени'))}
📱 Канал: ${escapeHtml(String(payload.channel_type ?? '—'))}
💬 Первое сообщение: "${escapeHtml(String(payload.first_message_preview ?? '—'))}"
⏰ ${new Date(payload.time as string).toLocaleString('ru-RU')}
      `.trim();

    case 'contact_received':
      return `
📞 <b>Лид оставил контакт</b>
👤 ${escapeHtml(String(payload.lead_name ?? '—'))}
${payload.phone ? `📱 Телефон: <b>${escapeHtml(String(payload.phone))}</b>` : ''}
${payload.email ? `📧 Email: <b>${escapeHtml(String(payload.email))}</b>` : ''}
🔗 <a href="${dashboardUrl}/leads/${payload.lead_id}">Открыть</a>
      `
        .split('\n')
        .filter((l) => l.trim())
        .join('\n');

    case 'repeat_touches_exhausted':
      return `
🔁 <b>Повторные касания исчерпаны</b>
👤 ${escapeHtml(String(payload.lead_name ?? '—'))}
📊 Отправлено попыток: ${payload.max_attempts ?? '—'}
💬 Лид так и не ответил
→ Принять решение: закрыть или оставить
      `.trim();

    case 'lead_returned':
      return `
💫 <b>Лид вернулся!</b>
👤 ${escapeHtml(String(payload.lead_name ?? '—'))}
⏰ Молчал: ${payload.days_silent ?? '—'} дней
💬 Написал: "${escapeHtml(String(payload.message_preview ?? '—'))}"
      `.trim();

    case 'scheduled_failed':
      return `
❌ <b>Запланированное сообщение не доставлено</b>
👤 Лид: ${escapeHtml(String(payload.lead_name ?? '—'))}
💬 Текст: "${escapeHtml(String(payload.message_preview ?? '—'))}"
❌ Ошибка: ${escapeHtml(String(payload.last_error ?? '—'))}
→ Отправить вручную
      `.trim();

    case 'ai_error':
      return `
🤖 <b>Проблема с AI</b>
❌ Gemini API: ${escapeHtml(String(payload.error_code ?? '—'))} ${escapeHtml(String(payload.error_message ?? '—'))}
⏰ ${new Date(payload.time as string).toLocaleString('ru-RU')}
→ Диалоги не обрабатываются автоматически
      `.trim();

    case 'worker_down':
      return `
⚠️ <b>Воркер не отвечает</b>
⏰ Последняя активность: ${payload.last_activity_ago ?? '—'} минут назад
📥 Необработанных сообщений: ${payload.pending_count ?? '—'}
→ Проверить Supabase Edge Functions / логи
      `.trim();

    case 'custom_condition':
      return formatTemplate(String(payload.template ?? '🔔 {{lead.name}}: {{lead.status}}'), {
        'lead.name': payload.lead_name,
        'lead.status': payload.status,
        lead: payload,
      });

    case 'kaspi_auth_expired':
      return `
⚠️ <b>Kaspi Pay требует реавторизации</b>
Сессия Kaspi Pay истекла. AI-агент больше не может выставлять счета.
→ Откройте Настройки → Интеграции → Kaspi Pay
      `.trim();

    default:
      return `🔔 Уведомление платформы\nТип: ${eventType}`;
  }
}

async function sendTelegramMessage(chatId: string, text: string, token: string) {
  if (!token) {
    throw new Error('Telegram bot token is not configured');
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    throw new Error(payload.description ?? 'telegram send failed');
  }
}

async function getActiveTelegramSettings(admin: ReturnType<typeof createAdminClient>, agentId: string | null) {
  if (!agentId) return null;

  const { data: settings } = await admin
    .from('extension_settings')
    .select('config')
    .eq('agent_id', agentId)
    .eq('extension_type', 'telegram_notifications')
    .eq('is_active', true)
    .maybeSingle();

  return settings?.config ?? null;
}

async function getBotTokenForRow(admin: ReturnType<typeof createAdminClient>, row: any): Promise<string | null> {
  const settings = await getActiveTelegramSettings(admin, row.agent_id ?? null);
  if (settings?.bot_token) {
    return String(settings.bot_token);
  }

  return BOT_TOKEN || null;
}

async function getAgentIdForRow(admin: ReturnType<typeof createAdminClient>, row: any): Promise<string | null> {
  if (row.agent_id) {
    return row.agent_id;
  }

  if (!row.lead_id) {
    return null;
  }

  const { data: lead } = await admin.from('leads').select('agent_id').eq('id', row.lead_id).maybeSingle();
  return lead?.agent_id ?? null;
}

async function resolveRecipientIdsForRow(admin: ReturnType<typeof createAdminClient>, row: any): Promise<string[]> {
  const recipients = new Set<string>();

  if (row.recipient_profile_id) {
    recipients.add(row.recipient_profile_id);
    return Array.from(recipients);
  }

  const agentId = await getAgentIdForRow(admin, row);
  const settings = await getActiveTelegramSettings(admin, agentId);

  if (Array.isArray(settings?.recipients)) {
    for (const recipient of settings.recipients) {
      if (recipient) recipients.add(recipient);
    }
  }

  if (['operator_needed', 'ai_silent', 'deal_won', 'contact_received'].includes(String(row.event_type || '')) && row.lead_id) {
    const { data: lead } = await admin.from('leads').select('assigned_to').eq('id', row.lead_id).maybeSingle();
    if (lead?.assigned_to) {
      recipients.add(lead.assigned_to);
    }
  }

  return Array.from(recipients);
}

async function splitPendingRow(admin: ReturnType<typeof createAdminClient>, row: any): Promise<boolean> {
  const recipientIds = await resolveRecipientIdsForRow(admin, row);
  if (recipientIds.length === 0) {
    return false;
  }

  const insertRows = recipientIds.map((recipient_profile_id) => ({
    org_id: row.org_id,
    agent_id: row.agent_id,
    lead_id: row.lead_id,
    event_type: row.event_type,
    custom_condition_key: row.custom_condition_key,
    recipient_profile_id,
    payload: row.payload,
    delivery_status: 'pending',
    attempts: 0,
  }));

  const { error } = await admin.from('notification_log').insert(insertRows);
  if (error) {
    console.error('[send-notifications] failed to split pending row', { rowId: row.id, error });
    return false;
  }

  await admin
    .from('notification_log')
    .update({
      delivery_status: 'failed',
      attempts: (row.attempts ?? 0) + 1,
      last_error: `missing recipient_profile_id; split into ${recipientIds.length} rows`,
    })
    .eq('id', row.id);

  return true;
}

export async function GET(req: NextRequest) {
  const token = req.headers.get(AUTH_HEADER)?.replace('Bearer ', '').trim();
  if (!token || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: pendingRows, error } = await admin
    .from('notification_log')
    .select('id, org_id, agent_id, lead_id, event_type, custom_condition_key, recipient_profile_id, payload, attempts')
    .eq('delivery_status', 'pending')
    .lt('attempts', 5)
    .order('sent_at', { ascending: true })
    .limit(50);

  if (error) {
    console.error('[send-notifications] failed to fetch pending rows', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const results = [] as Array<{ id: string; status: string; error?: string }>;

  for (const row of pendingRows ?? []) {
    try {
      if (!row.recipient_profile_id) {
        const split = await splitPendingRow(admin, row);
        if (split) {
          results.push({ id: row.id, status: 'split' });
          continue;
        }

        await admin
          .from('notification_log')
          .update({
            delivery_status: 'failed',
            attempts: (row.attempts ?? 0) + 1,
            last_error: 'missing recipient_profile_id',
          })
          .eq('id', row.id);

        results.push({ id: row.id, status: 'failed', error: 'missing recipient_profile_id' });
        continue;
      }

      const { data: profile } = await admin
        .from('profiles')
        .select('telegram_chat_id')
        .eq('id', row.recipient_profile_id)
        .maybeSingle();

      const chatId = String(profile?.telegram_chat_id || '');
      if (!chatId) {
        await admin
          .from('notification_log')
          .update({
            delivery_status: 'failed',
            attempts: (row.attempts ?? 0) + 1,
            last_error: 'recipient has no telegram chat id',
          })
          .eq('id', row.id);

        results.push({ id: row.id, status: 'failed', error: 'recipient has no telegram chat id' });
        continue;
      }

      const botToken = await getBotTokenForRow(admin, row);
      if (!botToken) {
        await admin
          .from('notification_log')
          .update({
            delivery_status: 'failed',
            attempts: (row.attempts ?? 0) + 1,
            last_error: 'telegram bot token is not configured',
          })
          .eq('id', row.id);

        results.push({ id: row.id, status: 'failed', error: 'telegram bot token is not configured' });
        continue;
      }

      const text = renderMessage(row);
      await sendTelegramMessage(chatId, text, botToken);

      await admin
        .from('notification_log')
        .update({
          delivery_status: 'sent',
          attempts: (row.attempts ?? 0) + 1,
        })
        .eq('id', row.id);

      results.push({ id: row.id, status: 'sent' });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('[send-notifications] failed to send notification', { rowId: row.id, error: errorMessage });
      await admin
        .from('notification_log')
        .update({
          delivery_status: 'failed',
          attempts: (row.attempts ?? 0) + 1,
          last_error: errorMessage,
        })
        .eq('id', row.id);
      results.push({ id: row.id, status: 'failed', error: errorMessage });
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}
