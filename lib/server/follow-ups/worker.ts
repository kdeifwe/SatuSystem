import { createAdminClient } from '@/lib/supabase/admin';
import { llmClient, type LLMMessage } from '@/lib/server/ai/llm-client';
import { GEMINI_CHAT_MODEL } from '@/lib/server/ai/gemini-client';
import { isWithinWorkHours } from '@/lib/extensions/work-hours';
import { peekBaileysClient, sendWhatsAppText } from '@/lib/channels/baileys-client';
import { sendTelegramText } from '@/lib/channels/telegram-client';
import { sendInstagramText } from '@/lib/channels/instagram-client';
import { enqueueNotification } from '@/lib/notifications';
import { normalizeRepeatTouchesConfig, type RepeatTouchesConfig } from './config';

type Admin = ReturnType<typeof createAdminClient>;

const MAX_SENDS_PER_AGENT_PER_RUN = 5;
const LLM_FAILURE_COOLDOWN_MS = 15 * 60 * 1000;
const EXHAUSTED_NOTIFY_AFTER_MS = 24 * 60 * 60 * 1000;
const SKIP_MARKER = '[[SKIP]]';

const llmFailures = new Map<string, number>();

interface Candidate {
  conversation_id: string;
  lead_id: string;
  last_message_at: string;
  last_user_at: string;
  touches_since_user: number;
  last_touch_at: string | null;
}

export interface RepeatTouchesRunResult {
  agents: number;
  candidates: number;
  sent: number;
  planned: Array<{ leadId: string; touch: number }>;
  skipped: Record<string, number>;
  errors: string[];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function usableFirstName(name: unknown): string | null {
  const value = String(name ?? '').trim();
  if (!value || value.length > 40 || /[@\d]/.test(value) || /^новый лид$/i.test(value)) return null;
  return value.split(/\s+/)[0];
}

function localTimeLabel(now: Date, timezone: string) {
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: timezone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    }).format(now);
  } catch {
    return now.toISOString();
  }
}

function cleanMessageText(raw: string): string {
  return raw
    .replace(/\*\*/g, '')
    .replace(/^["«“]+|["»”]+$/g, '')
    .replace(/\s+\n/g, '\n')
    .trim();
}

function mergeSameRole(messages: LLMMessage[]): LLMMessage[] {
  const merged: LLMMessage[] = [];
  for (const message of messages) {
    const last = merged[merged.length - 1];
    if (last && last.role === message.role && message.role !== 'system') {
      last.content = `${last.content}\n${message.content}`;
    } else {
      merged.push({ ...message });
    }
  }
  return merged;
}

function touchAngle(attemptIndex: number, total: number): string {
  if (attemptIndex + 1 >= total) {
    return 'Это ПОСЛЕДНЕЕ касание. Тепло и без давления закрой тему: скажи, что дверь открыта, и если станет актуально, можно просто написать. Допустима одна короткая фраза пользы, но без нового нажима.';
  }
  if (attemptIndex === 0) {
    return 'Это первое напоминание. Мягко вернись к последнему вопросу или следующему шагу из диалога и предложи помочь.';
  }
  return 'Это повторное напоминание, зайди с другого угла: помоги снять сомнение (спроси, что мешает или что уточнить) или предложи один конкретный удобный следующий шаг. Без давления.';
}

async function generateTouchText(params: {
  admin: Admin;
  agent: any;
  lead: any;
  conversationId: string;
  attemptIndex: number;
  cfg: RepeatTouchesConfig;
  timezone: string;
  now: Date;
}): Promise<{ text: string | null; skip: boolean }> {
  const { admin, agent, lead, conversationId, attemptIndex, cfg, timezone, now } = params;
  const total = cfg.schedule_minutes.length;
  const firstName = usableFirstName(lead.name);

  if (cfg.message_mode === 'fixed_templates') {
    const template = cfg.fixed_templates[attemptIndex % cfg.fixed_templates.length];
    const text = template
      .replace(/\{\{\s*name\s*\}\}/gi, firstName ?? '')
      .replace(/\s+([,.!?])/g, '$1')
      .trim();
    return { text: text || null, skip: false };
  }

  const [{ data: history }, { data: conv }] = await Promise.all([
    admin
      .from('messages')
      .select('sender, content, created_at')
      .eq('conversation_id', conversationId)
      .in('sender', ['user', 'ai', 'operator'])
      .order('created_at', { ascending: false })
      .limit(14),
    admin
      .from('conversations')
      .select('current_funnel_step, sticky_facts')
      .eq('id', conversationId)
      .maybeSingle(),
  ]);

  const turns: LLMMessage[] = (history ?? [])
    .slice()
    .reverse()
    .filter((m: any) => typeof m.content === 'string' && m.content.trim().length > 0)
    .map((m: any) => ({
      role: m.sender === 'user' ? ('user' as const) : ('assistant' as const),
      content: String(m.content).slice(0, 1200),
    }));

  const factsText = conv?.sticky_facts ? JSON.stringify(conv.sticky_facts).slice(0, 1500) : '';
  const persona = String(agent.system_prompt_compiled ?? '').slice(0, 7000);

  const system = [
    persona,
    '',
    '=== РЕЖИМ: ПОВТОРНОЕ КАСАНИЕ ===',
    `Клиент замолчал после твоего последнего сообщения. Сейчас ты пишешь касание №${attemptIndex + 2} (касание №1 — твой первый ответ в диалоге). Всего повторных касаний: ${total}.`,
    `Сейчас у клиента: ${localTimeLabel(now, timezone)}.`,
    firstName ? `Имя клиента: ${firstName}.` : '',
    conv?.current_funnel_step ? `Текущий этап воронки: ${conv.current_funnel_step}.` : '',
    factsText ? `Известные факты о клиенте: ${factsText}` : '',
    '',
    touchAngle(attemptIndex, total),
    '',
    'Правила:',
    '- Одно короткое сообщение: 1–2 предложения, до 220 символов, без списков, markdown и ссылок, не больше одного эмодзи.',
    '- Пиши на том же языке (русский или казахский), в том же тоне и стиле, что и в диалоге.',
    '- Не здоровайся заново, не представляйся, не повторяй свои прошлые сообщения дословно.',
    '- Опирайся на конкретику из диалога (что спрашивал клиент, какая услуга или товар обсуждались), а не на общие фразы.',
    '- Не выдумывай цены, скидки, сроки и акции, которых нет в диалоге или в твоих инструкциях выше. Не создавай ложную срочность.',
    '- Не дави и не упрекай клиента в молчании («вы пропали», «почему не отвечаете» нельзя).',
    '- Закончи лёгким вопросом, на который удобно ответить одним словом, либо понятным следующим шагом.',
    `- Если клиент отказался, попросил не писать, уже записался/оплатил/получил нужное, сказал что напишет сам, или разговор естественно завершён, ответь ровно: ${SKIP_MARKER}`,
    '- Верни только текст сообщения клиенту, без пояснений и кавычек.',
  ]
    .filter((line) => line !== '')
    .join('\n');

  const messages = mergeSameRole([
    { role: 'system', content: system },
    ...turns,
    { role: 'user', content: `Напиши касание №${attemptIndex + 2} клиенту. Если писать не нужно, ответь ${SKIP_MARKER}.` },
  ]);

  const response = await llmClient.generate({
    model: GEMINI_CHAT_MODEL,
    messages,
    temperature: 0.7,
    maxTokens: 300,
  });

  const raw = String(response.text ?? '').trim();
  if (raw.includes(SKIP_MARKER)) return { text: null, skip: true };

  const text = cleanMessageText(raw);
  if (!text || text.length > 600) return { text: null, skip: false };
  return { text, skip: false };
}

async function sendToLead(agentId: string, lead: any, text: string) {
  const channelType = Array.isArray(lead.channels) ? lead.channels[0]?.type : lead.channels?.type;
  if (channelType === 'whatsapp') {
    await sendWhatsAppText(agentId, lead.external_id, text);
  } else if (channelType === 'telegram') {
    await sendTelegramText(lead.channel_id, lead.external_id, escapeHtml(text));
  } else if (channelType === 'instagram') {
    await sendInstagramText(agentId, lead.external_id, text);
  } else {
    throw new Error(`Unsupported channel type: ${channelType}`);
  }
}

function channelReady(agentId: string, lead: any): boolean {
  const channelType = Array.isArray(lead.channels) ? lead.channels[0]?.type : lead.channels?.type;
  if (channelType === 'whatsapp') {
    const entry = peekBaileysClient(agentId);
    return Boolean(entry?.sock && entry.status === 'connected');
  }
  return channelType === 'telegram' || channelType === 'instagram';
}

async function notifyExhausted(admin: Admin, agent: any, lead: any, cand: Candidate, now: Date) {
  if (!cand.last_touch_at) return;
  if (now.getTime() - new Date(cand.last_touch_at).getTime() < EXHAUSTED_NOTIFY_AFTER_MS) return;

  const { data: existing } = await admin
    .from('notification_log')
    .select('id')
    .eq('event_type', 'repeat_touches_exhausted')
    .eq('lead_id', lead.id)
    .gt('sent_at', cand.last_user_at)
    .limit(1);
  if (existing && existing.length > 0) return;

  await enqueueNotification(
    'repeat_touches_exhausted',
    lead.id,
    agent.id,
    { lead_id: lead.id, lead_name: lead.name ?? null, max_attempts: cand.touches_since_user },
    { orgId: agent.org_id, skipDedupCheck: true },
  );
}

export async function runRepeatTouches(options: { now?: Date; dryRun?: boolean } = {}): Promise<RepeatTouchesRunResult> {
  const now = options.now ?? new Date();
  const dryRun = Boolean(options.dryRun);
  const admin = createAdminClient();

  const result: RepeatTouchesRunResult = { agents: 0, candidates: 0, sent: 0, planned: [], skipped: {}, errors: [] };
  const skip = (reason: string) => {
    result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  };

  const { data: settings, error: settingsError } = await admin
    .from('extension_settings')
    .select('agent_id, config')
    .eq('extension_type', 'repeat_touches')
    .eq('is_active', true);

  if (settingsError) {
    result.errors.push(`settings: ${settingsError.message}`);
    return result;
  }

  for (const row of settings ?? []) {
    const agentId = String(row.agent_id);
    const cfg = normalizeRepeatTouchesConfig(row.config);
    try {
      result.agents += 1;
      await processAgent({ admin, agentId, cfg, now, dryRun, result, skip });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[repeat-touches] agent failed', { agentId, error: message });
      result.errors.push(`${agentId}: ${message}`);
    }
  }

  return result;
}

async function processAgent(ctx: {
  admin: Admin;
  agentId: string;
  cfg: RepeatTouchesConfig;
  now: Date;
  dryRun: boolean;
  result: RepeatTouchesRunResult;
  skip: (reason: string) => void;
}) {
  const { admin, agentId, cfg, now, dryRun, result, skip } = ctx;

  const { data: agent } = await admin
    .from('agents')
    .select('id, org_id, name, is_active, deleted_at, system_prompt_compiled')
    .eq('id', agentId)
    .maybeSingle();
  if (!agent || agent.is_active === false || agent.deleted_at) {
    skip('agent_inactive');
    return;
  }

  const { data: org } = await admin.from('organizations').select('timezone').eq('id', agent.org_id).maybeSingle();
  const timezone = org?.timezone || 'Asia/Almaty';

  if (!isWithinWorkHours(now, timezone, { startHour: cfg.window_start_hour, endHour: cfg.window_end_hour })) {
    skip('outside_window');
    return;
  }

  const minDelayMinutes = Math.min(...cfg.schedule_minutes);
  const sinceMs = Math.max(
    now.getTime() - cfg.max_silence_hours * 3600_000,
    cfg.activated_at ? new Date(cfg.activated_at).getTime() : 0,
  );

  const { data: candidates, error: rpcError } = await admin.rpc('find_repeat_touch_candidates', {
    p_agent_id: agentId,
    p_since: new Date(sinceMs).toISOString(),
    p_min_silence_hours: minDelayMinutes / 60,
  });
  if (rpcError) throw new Error(`find_repeat_touch_candidates: ${rpcError.message}`);

  const list = (candidates ?? []) as Candidate[];
  result.candidates += list.length;

  const stopStatuses = new Set(cfg.stop_statuses);
  let sentThisRun = 0;

  for (const cand of list) {
    if (sentThisRun >= MAX_SENDS_PER_AGENT_PER_RUN) {
      skip('run_limit');
      break;
    }

    const attempts = cand.touches_since_user;
    const maxTouches = cfg.schedule_minutes.length;
    const lastAt = new Date(cand.last_message_at);

    if (attempts < maxTouches) {
      const delayMs = cfg.schedule_minutes[attempts] * 60_000;
      if (now.getTime() - lastAt.getTime() < delayMs) {
        skip('too_early');
        continue;
      }
    }

    const { data: lead } = await admin
      .from('leads')
      .select('id, org_id, name, status, ai_enabled, ai_paused, external_id, channel_id, channels(type)')
      .eq('id', cand.lead_id)
      .maybeSingle();
    if (!lead || !lead.external_id) {
      skip('lead_missing');
      continue;
    }

    if (attempts >= maxTouches) {
      if (!dryRun) await notifyExhausted(admin, agent, lead, cand, now);
      skip('exhausted');
      continue;
    }

    if (stopStatuses.has(String(lead.status ?? '').toLowerCase())) {
      skip('stop_status');
      continue;
    }
    if (cfg.stop_if_ai_disabled && lead.ai_enabled === false) {
      skip('ai_disabled');
      continue;
    }
    if (lead.ai_paused) {
      skip('ai_paused');
      continue;
    }
    if (!channelReady(agentId, lead)) {
      skip('channel_not_ready');
      continue;
    }

    const cooldownUntil = llmFailures.get(lead.id) ?? 0;
    if (cooldownUntil > now.getTime()) {
      skip('llm_cooldown');
      continue;
    }

    const { data: state } = await admin
      .from('lead_repeat_touch_state')
      .select('lead_id, attempts_sent, last_attempt_at, stopped_at')
      .eq('lead_id', lead.id)
      .maybeSingle();

    if (state?.stopped_at && new Date(state.stopped_at) >= new Date(cand.last_user_at)) {
      skip('stopped');
      continue;
    }
    // Попытка уже была после нашего последнего сообщения, но сообщения в БД нет:
    // отправка могла пройти, повторять не будем, пока лид не напишет.
    if (state?.last_attempt_at && new Date(state.last_attempt_at) > lastAt) {
      skip('attempt_unrecorded');
      continue;
    }

    if (dryRun) {
      result.planned.push({ leadId: lead.id, touch: attempts + 2 });
      continue;
    }

    if (!state) {
      await admin.from('lead_repeat_touch_state').upsert({ lead_id: lead.id }, { onConflict: 'lead_id', ignoreDuplicates: true });
    }

    // Атомарный захват: двойной запуск воркера не отправит касание дважды.
    const prevAttemptAt: string | null = state?.last_attempt_at ?? null;
    const claimIso = new Date().toISOString();
    let claimQuery = admin
      .from('lead_repeat_touch_state')
      .update({ last_attempt_at: claimIso, updated_at: claimIso })
      .eq('lead_id', lead.id);
    claimQuery = prevAttemptAt ? claimQuery.eq('last_attempt_at', prevAttemptAt) : claimQuery.is('last_attempt_at', null);
    const { data: claimed } = await claimQuery.select('lead_id');
    if (!claimed || claimed.length === 0) {
      skip('claim_lost');
      continue;
    }

    const revertClaim = async () => {
      await admin
        .from('lead_repeat_touch_state')
        .update({ last_attempt_at: prevAttemptAt, updated_at: new Date().toISOString() })
        .eq('lead_id', lead.id);
    };

    try {
      const generated = await generateTouchText({
        admin,
        agent,
        lead,
        conversationId: cand.conversation_id,
        attemptIndex: attempts,
        cfg,
        timezone,
        now,
      });

      if (generated.skip) {
        await admin
          .from('lead_repeat_touch_state')
          .update({ last_attempt_at: prevAttemptAt, stopped_at: new Date().toISOString(), stop_reason: 'llm_skip', updated_at: new Date().toISOString() })
          .eq('lead_id', lead.id);
        skip('llm_skip');
        continue;
      }
      if (!generated.text) {
        llmFailures.set(lead.id, Date.now() + LLM_FAILURE_COOLDOWN_MS);
        await revertClaim();
        skip('empty_text');
        continue;
      }

      await sendToLead(agentId, lead, generated.text);

      const sentAt = new Date().toISOString();
      const { error: insertError } = await admin.from('messages').insert({
        conversation_id: cand.conversation_id,
        sender: 'ai',
        content: generated.text,
        origin: 'followup',
        created_at: sentAt,
      });
      if (insertError) {
        console.error('[repeat-touches] touch sent but not recorded', { leadId: lead.id, error: insertError.message });
        result.errors.push(`${lead.id}: sent but not recorded: ${insertError.message}`);
      }

      await admin
        .from('lead_repeat_touch_state')
        .update({ attempts_sent: attempts + 1, last_attempt_at: sentAt, updated_at: sentAt })
        .eq('lead_id', lead.id);

      sentThisRun += 1;
      result.sent += 1;
      result.planned.push({ leadId: lead.id, touch: attempts + 2 });

      // Пауза между отправками, чтобы не выглядеть как рассылка.
      await sleep(2000 + Math.floor(Math.random() * 4000));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[repeat-touches] touch failed', { leadId: lead.id, error: message });
      llmFailures.set(lead.id, Date.now() + LLM_FAILURE_COOLDOWN_MS);
      result.errors.push(`${lead.id}: ${message}`);
      await revertClaim();
    }
  }
}
