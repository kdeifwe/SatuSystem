import { searchKnowledgeBase, formatChunksForPrompt } from '@/lib/knowledge-base/search';
import { geminiFetch, GEMINI_CHAT_MODEL } from '@/lib/server/ai/gemini-client';
import { createAdminClient } from '@/lib/supabase/admin';
import { splitAgentMessage, calculateTypingDelay } from '@/lib/server/ai/message-splitter';
import { injectHandoffSection, normalizeHandoffConfig, type HandoffConfig } from '@/lib/server/ai/handoff';

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

async function ensureLeadContext(admin: ReturnType<typeof createAdminClient>, agentId: string, userMessage: string) {
  const { data: agentData, error: agentError } = await admin
    .from('agents')
    .select('org_id')
    .eq('id', agentId)
    .single();

  if (agentError || !agentData?.org_id) {
    return { leadId: null, conversationId: null };
  }

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
    return { leadId: null, conversationId: null };
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

  return { leadId: lead.id, conversationId: conversation?.id ?? null };
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

export async function runAgentTurn(
  agentId: string,
  systemPrompt: string,
  userMessage: string,
  history: ChatMessage[],
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

  const res = await geminiFetch(GEMINI_CHAT_MODEL, 'generateContent', {
    system_instruction: { parts: [{ text: fullSystemPrompt }] },
    contents: [
      ...history.map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] })),
      { role: 'user', parts: [{ text: userMessage }] },
    ],
    tools: [{
      functionDeclarations: [{
        name: 'redirectToOperator',
        description: 'Передать диалог оператору и отключить AI',
        parameters: {
          type: 'object',
          properties: {
            reason: {
              type: 'string',
              description: 'Причина передачи оператора',
            },
          },
          required: ['reason'],
        },
      }],
    }],
    toolConfig: {
      functionCallingConfig: { mode: 'AUTO' },
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts as Array<Record<string, any>> | undefined;
  const answer = parts?.filter((part) => typeof part?.text === 'string').map((part) => part.text).join('\n') ?? '';
  const toolCalls = tryExtractToolCalls(parts);

  const { leadId, conversationId } = await ensureLeadContext(admin, agentId, userMessage);
  let finalAnswer = answer;
  let handoffMessage: string | undefined;

  if (handoffConfig.enabled && toolCalls.length > 0) {
    const toolCall = toolCalls[0];
    if (toolCall.name === 'redirectToOperator') {
      const result = await executeRedirectToOperator(
        admin,
        leadId,
        conversationId,
        String(toolCall.args.reason ?? 'Передача оператору'),
        handoffConfig,
      );
      finalAnswer = result.answer;
      handoffMessage = result.handoffMessage;
    }
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
