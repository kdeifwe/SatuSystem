 import { searchKnowledgeBase, formatChunksForPrompt } from '@/lib/knowledge-base/search';
import { geminiFetch, GEMINI_CHAT_MODEL } from '@/lib/server/ai/gemini-client';
import { createAdminClient } from '@/lib/supabase/admin';
import { splitAgentMessage, calculateTypingDelay } from '@/lib/server/ai/message-splitter';
import { injectHandoffSection, normalizeHandoffConfig, type HandoffConfig } from '@/lib/server/ai/handoff';
import { sendTelegramNotification } from '@/lib/extensions/telegram-notify';
import { PRODUCTION_TOOL_DECLARATIONS, type ToolCall } from '@/lib/ai/tools/registry';
import { executeTool, type ToolContext } from '@/lib/ai/tools/executor';

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export interface AgentMessagePart {
  text: string;
  delayMs: number;
}

export interface AgentTurnResult {
  answer: string;
  usedChunks: { id: string; similarity: number }[];
  messageParts: AgentMessagePart[];
  splitMessages: boolean;
  typingSimulation: boolean;
  handoffMessage?: string;
}

interface ToolCallRequest {
  name: string;
  args: Record<string, unknown>;
}

async function readAgentCapabilities(admin: ReturnType<typeof createAdminClient>, agentId: string) {
  const { data: agentData } = await admin
    .from('agents')
    .select('general_capabilities')
    .eq('id', agentId)
    .single();

  return normalizeHandoffConfig((agentData?.general_capabilities as Record<string, unknown> | null)?.handoff_config);
}

async function ensureLeadContext(admin: ReturnType<typeof createAdminClient>, agentId: string, userMessage: string, externalLeadId?: string) {
  const { data: agentData, error: agentError } = await admin
    .from('agents')
    .select('org_id')
    .eq('id', agentId)
    .single();

  if (agentError || !agentData?.org_id) {
    return { leadId: null, conversationId: null, orgId: null };
  }

  // If externalLeadId is provided (e.g., from Telegram webhook), use it directly
  if (externalLeadId) {
    const { data: existingLead } = await admin
      .from('leads')
      .select('id')
      .eq('id', externalLeadId)
      .single();

    if (!existingLead) {
      console.warn(`[orchestrator] External lead not found: ${externalLeadId}`);
      return { leadId: null, conversationId: null, orgId: agentData.org_id };
    }

    // Use the provided lead and find/create conversation
    let { data: conversation } = await admin
      .from('conversations')
      .select('id')
      .eq('lead_id', externalLeadId)
      .eq('agent_id', agentId)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!conversation) {
      const { data: createdConversation } = await admin
        .from('conversations')
        .insert({ lead_id: externalLeadId, agent_id: agentId })
        .select('id')
        .single();
      conversation = createdConversation;
    }

    if (conversation?.id) {
      await admin.from('messages').insert({
        conversation_id: conversation.id,
        sender: 'user',
        content: userMessage,
      });
    }

    return { leadId: externalLeadId, conversationId: conversation?.id ?? null, orgId: agentData.org_id };
  }

  // Otherwise, use sandbox lead (for direct API calls, not Telegram)
  const externalId = `sandbox:${agentId}`;
  let { data: lead } = await admin
    .from('leads')
    .select('id')
    .eq('org_id', agentData.org_id)
    .eq('external_id', externalId)
    .maybeSingle();

  if (!lead) {
    const { data: createdLead } = await admin
      .from('leads')
      .insert({
        org_id: agentData.org_id,
        external_id: externalId,
        name: 'Sandbox lead',
        ai_enabled: true,
      })
      .select('id')
      .single();
    lead = createdLead;
  }

  if (!lead?.id) {
    return { leadId: null, conversationId: null, orgId: agentData.org_id };
  }

  let { data: conversation } = await admin
    .from('conversations')
    .select('id')
    .eq('lead_id', lead.id)
    .eq('agent_id', agentId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!conversation) {
    const { data: createdConversation } = await admin
      .from('conversations')
      .insert({ lead_id: lead.id, agent_id: agentId })
      .select('id')
      .single();
    conversation = createdConversation;
  }

  if (conversation?.id) {
    await admin.from('messages').insert({
      conversation_id: conversation.id,
      sender: 'user',
      content: userMessage,
    });
  }

  return { leadId: lead.id, conversationId: conversation?.id ?? null, orgId: agentData.org_id };
}

async function appendMessage(admin: ReturnType<typeof createAdminClient>, conversationId: string | null, sender: 'ai' | 'system', content: string) {
  if (!conversationId) return;

  await admin.from('messages').insert({
    conversation_id: conversationId,
    sender,
    content,
  });
}

async function executeRedirectToOperator(
  admin: ReturnType<typeof createAdminClient>,
  agentId: string,
  leadId: string | null,
  conversationId: string | null,
  reason: string,
  handoffConfig: HandoffConfig,
) {
  const normalizedReason = reason?.trim() || 'Передача оператору';

  if (leadId) {
    await admin.from('leads').update({ ai_enabled: false }).eq('id', leadId);
    await admin.from('lead_notes').insert({
      lead_id: leadId,
      note: `Авто-передача оператору: ${normalizedReason}`,
    });
  }

  const handoffMessage = 'Разговор передан оператору';
  const clientMessage = handoffConfig.client_message?.trim() || 'Подключаю сотрудника, он уже видит наш диалог';

  if (conversationId) {
    await appendMessage(admin, conversationId, 'system', handoffMessage);
    await appendMessage(admin, conversationId, 'ai', clientMessage);
  }

  try {
    const { data: settingsRow } = await admin
      .from('extension_settings')
      .select('config')
      .eq('agent_id', agentId)
      .eq('extension_type', 'telegram_notifications')
      .maybeSingle();

    const config = (settingsRow?.config as { recipients?: string[]; events?: { operator_needed?: { enabled?: boolean } } } | null) ?? {};
    const isEnabled = config.events?.operator_needed?.enabled !== false;
    const recipientIds = Array.isArray(config.recipients) ? config.recipients : [];

    if (isEnabled && recipientIds.length) {
      const { data: profiles } = await admin
        .from('profiles')
        .select('telegram_chat_id')
        .in('id', recipientIds);

      for (const profile of profiles ?? []) {
        if (profile.telegram_chat_id) {
          await sendTelegramNotification(
            profile.telegram_chat_id,
            `🔔 Лид запросил оператора. Причина: ${normalizedReason}`
          );
        }
      }
    }
  } catch (error) {
    console.error('[orchestrator] failed to send Telegram handoff notification', error);
  }

  return {
    answer: clientMessage,
    handoffMessage,
  };
}

function tryExtractToolCalls(parts: Array<Record<string, any>> | undefined): ToolCallRequest[] {
  if (!Array.isArray(parts)) return [];

  return parts
    .filter((part) => part?.functionCall?.name)
    .map((part) => ({
      name: part.functionCall.name,
      args: part.functionCall.args ?? {},
    }));
}

function extractTextFromParts(parts: Array<Record<string, unknown>> | undefined): string {
  if (!Array.isArray(parts)) return '';

  return parts
    .filter((part) => typeof part?.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

export async function runAgentTurn(
  agentId: string,
  systemPrompt: string,
  userMessage: string,
  history: ChatMessage[],
  externalLeadId?: string, // Optional: for Telegram/webhook-identified leads
): Promise<AgentTurnResult> {
  const admin = createAdminClient();
  const handoffConfig = await readAgentCapabilities(admin, agentId);
  const basePrompt = injectHandoffSection(systemPrompt, handoffConfig);

  // 1. RAG — ищем релевантные чанки ДО вызова Gemini
  const chunks = await searchKnowledgeBase(agentId, userMessage);
  const kbContext = formatChunksForPrompt(chunks);

  console.log(`[RAG] Agent ${agentId}: найдено ${chunks.length} чанков для запроса "${userMessage.slice(0, 50)}..."`);
  console.log(`[RAG] Топ-3 чанка:`, chunks.slice(0, 3).map(c => ({
    similarity: c.similarity.toFixed(2),
    preview: c.content.slice(0, 80),
  })));

  // 2. Добавляем контекст базы знаний в system prompt
  // ВАЖНО: контент пользователя — отдельным объектом в contents[],
  // НЕ внутри system prompt (защита от prompt injection)
  const fullSystemPrompt = `${basePrompt}

<knowledge_base>
${kbContext}
</knowledge_base>

Правило: отвечай ТОЛЬКО на основе информации выше. Если данных нет — честно скажи об этом.`;

  const toolDeclarations = PRODUCTION_TOOL_DECLARATIONS;
  console.log('[PROD_TOOL_DECLS]', toolDeclarations.map((declaration) => declaration.name));

  const res = await geminiFetch(GEMINI_CHAT_MODEL, 'generateContent', {
    system_instruction: { parts: [{ text: fullSystemPrompt }] },
    contents: [
      ...history.map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] })),
      { role: 'user', parts: [{ text: userMessage }] },
    ],
    tools: [{
      functionDeclarations: toolDeclarations,
    }],
    toolConfig: {
      functionCallingConfig: { mode: 'AUTO' },
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    try {
      // record consecutive AI error
      const { data: existing } = await admin.from('ai_error_counters').select('consecutive_errors').eq('agent_id', agentId).maybeSingle();
      const prev = existing?.consecutive_errors ?? 0;
      const next = prev + 1;
      await admin.from('ai_error_counters').upsert({ agent_id: agentId, consecutive_errors: next, last_error_at: new Date(), updated_at: new Date().toISOString() });
      if (next >= 3) {
        await admin.from('notification_log').insert({
          org_id: (await admin.from('agents').select('org_id').eq('id', agentId).maybeSingle()).data?.org_id,
          agent_id: agentId,
          lead_id: null,
          event_type: 'ai_error',
          payload: { error: errText ?? `status ${res.status}`, attempts: next },
          delivery_status: 'pending'
        });
        // reset counter after enqueue
        await admin.from('ai_error_counters').update({ consecutive_errors: 0, updated_at: new Date().toISOString() }).eq('agent_id', agentId);
      }
    } catch (e) {
      console.error('[orchestrator] failed to record ai_error counter', e);
    }

    throw new Error(`Gemini API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  // reset consecutive error counter on success
  try {
    await admin.from('ai_error_counters').update({ consecutive_errors: 0, updated_at: new Date().toISOString() }).eq('agent_id', agentId);
  } catch (e) {
    // non-fatal
  }
  let currentParts = data.candidates?.[0]?.content?.parts as Array<Record<string, any>> | undefined;
  let finalAnswer = extractTextFromParts(currentParts);
  let handoffMessage: string | undefined;
  let handoffTriggered = false;

  const { leadId, conversationId, orgId } = await ensureLeadContext(admin, agentId, userMessage, externalLeadId);
  const toolContext: ToolContext = {
    leadId: leadId ?? '',
    agentId,
    orgId: orgId ?? '',
    conversationId: conversationId ?? '',
    isSandbox: false,
  };
  const allowedToolNames = toolDeclarations.map((declaration) => declaration.name);
  let toolCalls = tryExtractToolCalls(currentParts);
  let iterations = 0;
  let toolsUsed: string[] = [];

  while (iterations < 5 && toolCalls.length > 0) {
    iterations += 1;
    const toolResults: Array<Record<string, unknown>> = [];

    for (const toolCall of toolCalls) {
      if (!allowedToolNames.includes(toolCall.name)) {
        toolResults.push({ name: toolCall.name, result: null, error: `Инструмент ${toolCall.name} не разрешён для этого агента.` });
        continue;
      }

      toolsUsed.push(toolCall.name);
      console.log('[PROD_TOOL] calling', { agentId, conversationId, name: toolCall.name, args: toolCall.args });
      const toolResult = await executeTool(toolCall as ToolCall, toolContext);
      toolResults.push({ name: toolCall.name, result: toolResult.result, error: toolResult.error });
      console.log('[PROD_TOOL_RESULT]', { agentId, name: toolCall.name, result: toolResult.result, error: toolResult.error });

      if (toolCall.name === 'redirectToOperator' && toolResult.result && !toolResult.error) {
        handoffTriggered = true;
        break;
      }
    }

    if (handoffTriggered) {
      break;
    }

    const functionResponseParts = toolResults.map((result) => ({
      functionResponse: {
        name: result.name,
        response: result.error ? { error: result.error } : { result: result.result },
      },
    }));
    console.log('[PROD_TOOL_FOLLOWUP]', { agentId, toolResults, functionResponseParts });

    const followUpRes = await geminiFetch(GEMINI_CHAT_MODEL, 'generateContent', {
      system_instruction: { parts: [{ text: fullSystemPrompt }] },
      contents: [
        ...history.map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] })),
        { role: 'user', parts: [{ text: userMessage }] },
        { role: 'model', parts: currentParts ?? [] },
        { role: 'user', parts: functionResponseParts },
      ],
      tools: [{
        functionDeclarations: toolDeclarations,
      }],
      toolConfig: {
        functionCallingConfig: { mode: 'AUTO' },
      },
    });

    if (!followUpRes.ok) {
      const errText = await followUpRes.text();
      throw new Error(`Gemini API error ${followUpRes.status}: ${errText}`);
    }

    const followUpData = await followUpRes.json();
    currentParts = followUpData.candidates?.[0]?.content?.parts as Array<Record<string, any>> | undefined;
    finalAnswer = extractTextFromParts(currentParts) || finalAnswer;
    console.log('[PROD_TOOL_FOLLOWUP_RESPONSE]', { agentId, answer: finalAnswer, toolCalls: tryExtractToolCalls(currentParts) });
    toolCalls = tryExtractToolCalls(currentParts);
  }

  if (handoffTriggered) {
    console.log('[PROD_HANDOFF_TRIGGERED]', { agentId, leadId, conversationId, reason: toolsUsed.join(',') });
    finalAnswer = finalAnswer || 'Сейчас подключу коллегу, пожалуйста, подождите.';
  }

  if (!finalAnswer.trim()) {
    finalAnswer = handoffConfig.client_message?.trim() || 'Подключаю сотрудника, он уже видит наш диалог';
  }

  if (conversationId) {
    await appendMessage(admin, conversationId, 'ai', finalAnswer);
  }

  const { data: agentData } = await admin
    .from('agents')
    .select('general_capabilities')
    .eq('id', agentId)
    .single();

  const capabilities = (agentData?.general_capabilities as Record<string, unknown> | null) ?? {};
  const splitMessages = Boolean(capabilities.split_messages ?? true);
  const splitMaxParts = Math.min(3, Math.max(1, Number(capabilities.split_max_parts ?? 3)));
  const typingSimulation = Boolean(capabilities.typing_simulation ?? true);

  const messageParts = splitAgentMessage(finalAnswer, splitMessages, splitMaxParts).map((part) => ({
    text: part.text,
    delayMs: typingSimulation ? calculateTypingDelay(part.text) + part.delayMs : part.delayMs,
  }));

  return {
    answer: finalAnswer,
    usedChunks: chunks.map(c => ({ id: c.chunk_id, similarity: c.similarity })),
    messageParts,
    splitMessages,
    typingSimulation,
    handoffMessage,
  };
}
