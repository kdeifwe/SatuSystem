// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.1';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const botToken = Deno.env.get('TELEGRAM_NOTIFICATIONS_BOT_TOKEN') ?? '';
const appUrl = Deno.env.get('NEXT_PUBLIC_APP_URL') ?? 'http://localhost:3001';

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function formatTemplate(template: string, payload: Record<string, unknown>) {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, key: string) => {
    const value = payload[key.trim()];
    return value !== null && value !== undefined ? String(value) : '—';
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderMessage(record: Record<string, unknown>): string {
  const eventType = record.event_type as string;
  const payload = (record.payload as Record<string, unknown>) ?? {};

  const dashboardUrl = `${appUrl}/dashboard`;

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

    default:
      return `🔔 Уведомление платформы\nТип: ${eventType}`;
  }
}

async function sendTelegramMessage(chatId: string, text: string) {
  if (!botToken || !chatId) {
    return;
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    throw new Error(payload.description ?? 'telegram send failed');
  }
}

Deno.serve(async () => {
  const { data: pendingRows, error } = await supabase
    .from('notification_log')
    .select('id, agent_id, lead_id, event_type, custom_condition_key, recipient_profile_id, payload, attempts')
    .eq('delivery_status', 'pending')
    .lt('attempts', 5)
    .order('sent_at', { ascending: true })
    .limit(50);

  if (error) {
    console.error(error);
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  for (const row of pendingRows ?? []) {
    const recipientId = row.recipient_profile_id;
    if (!recipientId) {
      await supabase
        .from('notification_log')
        .update({ delivery_status: 'failed', attempts: (row.attempts ?? 0) + 1, last_error: 'missing recipient' })
        .eq('id', row.id);
      continue;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('telegram_chat_id')
      .eq('id', recipientId)
      .maybeSingle();

    if (!profile?.telegram_chat_id) {
      await supabase
        .from('notification_log')
        .update({ delivery_status: 'failed', attempts: (row.attempts ?? 0) + 1, last_error: 'recipient has no telegram chat id' })
        .eq('id', row.id);
      continue;
    }

    try {
      const text = renderMessage(row);

      await sendTelegramMessage(String(profile.telegram_chat_id), text);

      await supabase
        .from('notification_log')
        .update({ delivery_status: 'sent', attempts: (row.attempts ?? 0) + 1 })
        .eq('id', row.id);
      // reset channel error counter on success
      try {
        await supabase.from('channel_error_counters').update({ consecutive_errors: 0 }).eq('channel_type', 'telegram');
      } catch (e) {
        console.error('[send-notifications] failed to reset channel error counter', e);
      }
    } catch (error) {
      await supabase
        .from('notification_log')
        .update({ delivery_status: 'failed', attempts: (row.attempts ?? 0) + 1, last_error: String(error) })
        .eq('id', row.id);

      try {
        const { data: existing } = await supabase.from('channel_error_counters').select('consecutive_errors').eq('channel_type', 'telegram').maybeSingle();
        const prev = existing?.consecutive_errors ?? 0;
        const next = prev + 1;
        await supabase.from('channel_error_counters').upsert({ channel_type: 'telegram', consecutive_errors: next, last_error_at: new Date() });
        if (next >= 3) {
          // Enqueue channel_down notification
          await supabase.from('notification_log').insert({
            org_id: (await supabase.from('profiles').select('org_id').eq('id', recipientId).maybeSingle()).data?.org_id,
            agent_id: (await supabase.from('agents').select('id').order('created_at').limit(1).maybeSingle()).data?.id,
            lead_id: null,
            event_type: 'channel_down',
            payload: { channel_type: 'telegram', channel_name: 'Telegram Bot', error_message: String(error), time: new Date() },
            delivery_status: 'pending'
          });
          await supabase.from('channel_error_counters').update({ consecutive_errors: 0 }).eq('channel_type', 'telegram');
        }
      } catch (e) {
        console.error('[send-notifications] failed to update channel_error_counters', e);
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, processed: pendingRows?.length ?? 0 }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
