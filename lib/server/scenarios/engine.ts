import { createAdminClient } from '@/lib/supabase/admin';
import { llmClient, type LLMMessage } from '@/lib/server/ai/llm-client';
import { GEMINI_CHAT_MODEL } from '@/lib/server/ai/gemini-client';

export type ScenarioTrigger =
  | { type: 'status_enter'; status: string }
  | { type: 'no_reply_minutes'; minutes: number };

export type ScenarioAction =
  | {
      type: 'send_message';
      text: string;
      use_whatsapp_template?: boolean;
      template_name?: string;
    }
  | { type: 'ai_write'; instruction: string }
  | { type: 'change_status'; status: string }
  | { type: 'add_note'; note: string }
  | { type: 'notify_operator'; message: string };

interface ScenarioRow {
  id: string;
  org_id: string;
  name: string | null;
  trigger: ScenarioTrigger;
  actions: ScenarioAction[];
  is_active: boolean;
}

interface LeadRow {
  id: string;
  org_id: string;
  status: string;
  ai_enabled: boolean;
  updated_at: string;
  channel_id: string | null;
  assigned_to: string | null;
}

interface ConversationRow {
  id: string;
}

export async function runScenariosForLead(
  leadId: string,
  eventType: 'status_enter' | 'no_reply_check',
) {
  const admin = createAdminClient();
  const lead = await loadLead(admin, leadId);
  if (!lead) {
    throw new Error(`Лид ${leadId} не найден`);
  }

  const scenarios = await loadActiveScenarios(admin, lead.org_id);
  if (scenarios.length === 0) {
    return { processed: 0 };
  }

  const conversationId = await getOrCreateConversation(admin, lead.id);
  const results = [] as Array<{ scenarioId: string; result: string }>;

  for (const scenario of scenarios) {
    const triggerMatches = await matchTrigger(admin, lead, conversationId, scenario, eventType);
    if (!triggerMatches) {
      continue;
    }

    const errors: string[] = [];
    for (const action of scenario.actions ?? []) {
      try {
        await executeScenarioAction(admin, lead, scenario, conversationId, action);
      } catch (error) {
        errors.push(String(error instanceof Error ? error.message : error));
      }
    }

    const resultText = errors.length > 0 ? `error: ${errors.join('; ')}` : 'ok';
    await admin.from('scenario_runs').insert({
      scenario_id: scenario.id,
      lead_id: lead.id,
      result: resultText,
    });

    results.push({ scenarioId: scenario.id, result: resultText });
  }

  return { processed: results.length, results };
}

async function loadLead(admin: ReturnType<typeof createAdminClient>, leadId: string): Promise<LeadRow | null> {
  const { data, error } = await admin
    .from('leads')
    .select('id, org_id, status, ai_enabled, updated_at, channel_id, assigned_to')
    .eq('id', leadId)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as LeadRow | null;
}

async function loadActiveScenarios(admin: ReturnType<typeof createAdminClient>, orgId: string) {
  const { data, error } = await admin
    .from('scenarios')
    .select('id, org_id, name, trigger, actions, is_active')
    .eq('org_id', orgId)
    .eq('is_active', true);

  if (error) {
    throw new Error(error.message);
  }

  return (data as ScenarioRow[] | null) ?? [];
}

async function getOrCreateConversation(
  admin: ReturnType<typeof createAdminClient>,
  leadId: string,
): Promise<string> {
  const { data: conversation } = await admin
    .from('conversations')
    .select('id')
    .eq('lead_id', leadId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (conversation?.id) {
    return conversation.id;
  }

  const { data, error } = await admin
    .from('conversations')
    .insert({ lead_id: leadId, agent_id: null })
    .select('id')
    .single();

  if (error || !data?.id) {
    throw new Error(error?.message ?? 'Не удалось создать беседу');
  }

  return data.id;
}

async function loadLastUserMessageDate(
  admin: ReturnType<typeof createAdminClient>,
  conversationId: string,
) {
  const { data, error } = await admin
    .from('messages')
    .select('created_at')
    .eq('conversation_id', conversationId)
    .eq('sender', 'user')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data?.created_at ? new Date(data.created_at) : null;
}

async function hasRecentScenarioRun(
  admin: ReturnType<typeof createAdminClient>,
  scenarioId: string,
  leadId: string,
  minutes: number,
) {
  const threshold = new Date(Date.now() - minutes * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from('scenario_runs')
    .select('id', { count: 'exact' })
    .eq('scenario_id', scenarioId)
    .eq('lead_id', leadId)
    .gte('ran_at', threshold);

  if (error) {
    throw new Error(error.message);
  }

  return Array.isArray(data) && data.length > 0;
}

async function matchTrigger(
  admin: ReturnType<typeof createAdminClient>,
  lead: LeadRow,
  conversationId: string,
  scenario: ScenarioRow,
  eventType: 'status_enter' | 'no_reply_check',
) {
  const trigger = scenario.trigger;
  if (!trigger || !trigger.type) {
    return false;
  }

  if (trigger.type === 'status_enter') {
    if (eventType !== 'status_enter') return false;
    if (trigger.status !== lead.status) return false;
    return !(await hasRecentScenarioRun(admin, scenario.id, lead.id, 5));
  }

  if (trigger.type === 'no_reply_minutes') {
    if (eventType !== 'no_reply_check') return false;
    if (typeof trigger.minutes !== 'number' || trigger.minutes <= 0) {
      return false;
    }
    const lastUserDate = await loadLastUserMessageDate(admin, conversationId);
    if (!lastUserDate) {
      return false;
    }
    const threshold = new Date(Date.now() - trigger.minutes * 60 * 1000);
    if (lastUserDate > threshold) {
      return false;
    }
    return !(await hasRecentScenarioRun(admin, scenario.id, lead.id, trigger.minutes));
  }

  return false;
}

async function insertMessage(
  admin: ReturnType<typeof createAdminClient>,
  conversationId: string,
  sender: 'system' | 'ai',
  content: string,
  origin: 'conversation' | 'scenario' | 'broadcast' | 'followup' = 'scenario',
) {
  await admin.from('messages').insert({
    conversation_id: conversationId,
    sender,
    content,
    origin,
  });
}

async function executeScenarioAction(
  admin: ReturnType<typeof createAdminClient>,
  lead: LeadRow,
  scenario: ScenarioRow,
  conversationId: string,
  action: ScenarioAction,
) {
  switch (action.type) {
    case 'send_message': {
      const text = action.text?.trim() ?? '';
      if (!text) {
        throw new Error('Текст сообщения не задан');
      }
      await insertMessage(admin, conversationId, 'system', text, 'scenario');
      await sendToChannel(lead, text, action.use_whatsapp_template ?? false, action.template_name);
      return;
    }

    case 'ai_write': {
      const instruction = action.instruction?.trim() ?? '';
      if (!instruction) {
        throw new Error('Инструкция для ИИ не задана');
      }
      const answer = await runAiWrite(admin, conversationId, instruction);
      await insertMessage(admin, conversationId, 'ai', answer, 'scenario');
      return;
    }

    case 'change_status': {
      const status = action.status?.trim();
      if (!status) {
        throw new Error('Новый статус не задан');
      }
      await admin
        .from('leads')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', lead.id);
      return;
    }

    case 'add_note': {
      const note = action.note?.trim() ?? '';
      if (!note) {
        throw new Error('Текст заметки не задан');
      }
      await admin.from('lead_notes').insert({
        lead_id: lead.id,
        author_id: null,
        note: `${note} [сценарий: ${scenario.name ?? 'без названия'}]`,
      });
      return;
    }

    case 'notify_operator': {
      const message = action.message?.trim() ?? '';
      if (!message) {
        throw new Error('Текст уведомления оператору не задан');
      }
      const notificationText = `🔔 ${message}`;
      await insertMessage(admin, conversationId, 'system', notificationText, 'scenario');
      if (lead.assigned_to) {
        await admin.from('messages').insert({
          conversation_id: conversationId,
          sender: 'system',
          content: `Уведомление оператору: ${notificationText}`,
          origin: 'scenario',
        });
      }
      return;
    }

    default:
      throw new Error(`Неизвестный тип действия: ${(action as any).type}`);
  }
}

async function runAiWrite(
  admin: ReturnType<typeof createAdminClient>,
  conversationId: string,
  instruction: string,
) {
  const { data: history, error } = await admin
    .from('messages')
    .select('sender, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  const contents = (history ?? []).map((item: { sender: string; content: string }) => ({
    role: item.sender === 'user' ? 'user' : 'model',
    parts: [{ text: item.content }],
  }));

  const prompt = `Выполни задачу: ${instruction}. Используй только историю диалога ниже и составь ответ от лица AI.`;

    const messages: LLMMessage[] = [
      { role: 'system', content: prompt },
      ...(contents.map((item) => ({
        role: item.role === 'user' ? 'user' : 'assistant',
        content: item.parts?.[0]?.text ?? '',
      })) as LLMMessage[]),
      { role: 'user', content: instruction },
    ];

    const llmResponse = await llmClient.generate({
      model: GEMINI_CHAT_MODEL,
      messages,
      temperature: 0.7,
    });

  const answer = llmResponse.text.trim();
  return answer || 'AI-сообщение создано, но текст пустой';
}

async function sendToChannel(
  lead: LeadRow,
  text: string,
  useWhatsappTemplate: boolean,
  templateName?: string,
) {
  // В текущем коде нет реальной реализации отправки через WhatsApp/Telegram.
  // Для поддержки сценариев сохраняем сообщение в БД и логируем попытку отправки.
  console.log('sendToChannel stub', { leadId: lead.id, channelId: lead.channel_id, useWhatsappTemplate, templateName, text });
}
