import { createAdminClient } from '../supabase/admin.ts';
import { geminiFetch, GEMINI_CHAT_MODEL } from '../server/ai/gemini-client.ts';
import { AGENT_TOOLS, type ToolCall } from './tools/registry.ts';
import { executeTool, type ToolContext } from './tools/executor.ts';
import { validateAgentAnswer } from './validate-output.ts';
import { compileAndSaveSystemPrompt } from './compile-system-prompt.ts';

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
  usedChunks: Array<{ id: string; similarity: number }>;
  messageParts: AgentMessagePart[];
  splitMessages: boolean;
  typingSimulation: boolean;
  toolsUsed?: string[];
  tokensInput?: number;
  tokensOutput?: number;
  latencyMs?: number;
}

interface GeminiResponsePayload {
  parts: Array<Record<string, unknown>>;
  finishReason?: string;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

interface GeminiClientResponse {
  payload: GeminiResponsePayload;
  usedModel: string;
}

async function ensureLeadContext(admin: ReturnType<typeof createAdminClient>, agentId: string, userMessage: string) {
  const { data: agentData } = await admin.from('agents').select('org_id').eq('id', agentId).single();
  if (!agentData?.org_id) {
    return { leadId: null, conversationId: null, userMessageId: null };
  }

  const externalId = `sandbox:${agentId}`;
  let { data: lead } = await admin.from('leads').select('id').eq('org_id', agentData.org_id).eq('external_id', externalId).maybeSingle();

  if (!lead) {
    const { data: createdLead } = await admin.from('leads').insert({
      org_id: agentData.org_id,
      external_id: externalId,
      name: 'Sandbox lead',
      ai_enabled: true,
    }).select('id').single();
    lead = createdLead;
  }

  if (!lead?.id) {
    return { leadId: null, conversationId: null, userMessageId: null };
  }

  let { data: conversation } = await admin.from('conversations').select('id').eq('lead_id', lead.id).eq('agent_id', agentId).order('started_at', { ascending: false }).limit(1).maybeSingle();

  if (!conversation) {
    const { data: createdConversation } = await admin.from('conversations').insert({ lead_id: lead.id, agent_id: agentId }).select('id').single();
    conversation = createdConversation;
  }

  const { data: insertedMessage, error: messageError } = await admin.from('messages').insert({
    conversation_id: conversation?.id,
    sender: 'user',
    content: userMessage,
  }).select('id').single();

  if (messageError || !insertedMessage?.id) {
    return { leadId: lead.id, conversationId: conversation?.id ?? null, userMessageId: null };
  }

  return { leadId: lead.id, conversationId: conversation?.id ?? null, userMessageId: insertedMessage.id };
}

function buildChatHistory(history: ChatMessage[]) {
  return history.filter((m) => m.text?.trim()).map((m) => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.text }],
  }));
}

function extractToolCalls(parts: Array<Record<string, unknown>> | undefined): ToolCall[] {
  if (!Array.isArray(parts)) return [];

  return parts.filter((part) => typeof part?.functionCall === 'object' && part.functionCall && typeof (part.functionCall as Record<string, unknown>).name === 'string').map((part) => ({
    name: ((part.functionCall as Record<string, unknown>).name as string) as ToolCall['name'],
    args: ((part.functionCall as Record<string, unknown>).args as Record<string, unknown>) ?? {},
  }));
}

async function callGemini(
  modelName: string,
  systemPrompt: string,
  contents: Array<Record<string, unknown>>,
  tools: Array<Record<string, unknown>>,
  previousToolCalls?: Array<Record<string, unknown>>,
  retryCount = 0
): Promise<GeminiClientResponse> {
  const body: Record<string, unknown> = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    tools,
    toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
    generationConfig: { temperature: 0.7, topP: 0.9, maxOutputTokens: 1024 },
  };

  if (process.env.LOG_GEMINI_RAW === '1') {
    try {
      console.log('[GEMINI][REQUEST_BODY]', JSON.stringify(body));
    } catch (e) {
      console.warn('[GEMINI] failed to stringify request body', e);
    }
  }

  if (previousToolCalls && previousToolCalls.length > 0) {
    body.contents = contents;
  }

  const res = await geminiFetch(modelName, 'generateContent', body);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  if (process.env.LOG_GEMINI_RAW === '1') {
    try {
      console.log('[GEMINI][RAW_RESPONSE]', JSON.stringify(data));
    } catch (e) {
      console.warn('[GEMINI] failed to stringify raw response', e);
    }
  }
  const candidate = data.candidates?.[0];
  const parts = (candidate?.content?.parts as Array<Record<string, unknown>> | undefined) ?? [];
  const finishReason = candidate?.finishReason ?? candidate?.finish_reason;
  const usageMetadata = candidate?.usageMetadata ?? data.usageMetadata;

  if (finishReason === 'MAX_TOKENS' && retryCount === 0) {
    const retryPayload = await callGemini(modelName, systemPrompt, contents, tools, previousToolCalls, 1);
    return retryPayload;
  }

  return {
    payload: {
      parts,
      finishReason,
      usageMetadata: {
        promptTokenCount: usageMetadata?.promptTokenCount ?? usageMetadata?.prompt_tokens ?? 0,
        candidatesTokenCount: usageMetadata?.candidatesTokenCount ?? usageMetadata?.candidates_tokens ?? 0,
      },
    },
    usedModel: modelName,
  };
}

async function appendMessage(admin: ReturnType<typeof createAdminClient>, conversationId: string | null, sender: 'ai' | 'system', content: string, toolCalls?: unknown) {
  if (!conversationId) return null;
  const { data, error } = await admin.from('messages').insert({ conversation_id: conversationId, sender, content, tool_calls: toolCalls ?? null }).select('id').single();
  if (error) throw new Error(`Не удалось сохранить сообщение: ${error.message}`);
  return data?.id ?? null;
}

export async function runAgentTurn(agentId: string, systemPrompt: string, userMessage: string, history: ChatMessage[]): Promise<AgentTurnResult> {
  const admin = createAdminClient();
  const startTime = Date.now();
  const agentData = await admin.from('agents').select('id, name, model, temperature, top_p, org_id, system_prompt_compiled, general_capabilities').eq('id', agentId).single();
  const agent = agentData.data;

  if (!agent) {
    throw new Error(`Агент не найден: ${agentId}`);
  }

  let compiledPrompt = agent.system_prompt_compiled ?? systemPrompt;
  if (!compiledPrompt?.trim()) {
    compiledPrompt = await compileAndSaveSystemPrompt(agentId);
  }

  const generalCapabilities = (agent.general_capabilities as Record<string, unknown> | null) ?? {};
  const configuredAllowedTools = Array.isArray(generalCapabilities.allowed_tools)
    ? (generalCapabilities.allowed_tools as string[]).filter((name) => typeof name === 'string')
    : [];

  const availableToolNames = AGENT_TOOLS[0].functionDeclarations?.map((f) => f.name) ?? [];
  const allowedToolNames = configuredAllowedTools.length > 0
    ? configuredAllowedTools.filter((name) => availableToolNames.includes(name))
    : availableToolNames;
  const allowedToolDeclarations = allowedToolNames.length > 0
    ? [{ functionDeclarations: AGENT_TOOLS[0].functionDeclarations.filter((f) => allowedToolNames.includes(f.name)) }]
    : [];

  const { leadId, conversationId, userMessageId } = await ensureLeadContext(admin, agentId, userMessage);
  const toolContext: ToolContext = {
    leadId: leadId ?? '',
    agentId,
    orgId: agent.org_id ?? '',
    conversationId: conversationId ?? '',
    isSandbox: true,
  };

  const baseContents = [
    ...buildChatHistory(history),
    { role: 'user', parts: [{ text: userMessage }] },
  ];

  let response = await callGemini(agent.model ?? GEMINI_CHAT_MODEL, compiledPrompt, baseContents, allowedToolDeclarations);
  let parts = response.payload.parts;
  let toolsUsed: string[] = [];
  let iterations = 0;
  let searchLookupCount = 0;
  let handoffTriggered = false;
  let fallbackReason: string | null = null;
  let forcedFinalization = false;
  let accumulatedToolResults: Array<Record<string, unknown>> = [];
  let validationAttempted = false;

  while (iterations < 5) {
    const functionCalls = extractToolCalls(parts as Array<Record<string, unknown>> | undefined);
    if (functionCalls.length === 0) break;

    iterations += 1;

    const toolResults = [] as Array<Record<string, unknown>>;
    for (const call of functionCalls) {
      if (!allowedToolNames.includes(call.name)) {
        const message = `Инструмент ${call.name} не разрешён для этого агента.`;
        console.warn(`[AGENT] unauthorized tool call`, { agentId, conversationId, call: call.name, userMessage, message });
        toolResults.push({ name: call.name, result: null, error: message });
        continue;
      }

      if (call.name === 'searchKnowledgeBase') {
        searchLookupCount += 1;
        if (searchLookupCount > 3) {
          // trigger forced finalization using accumulated tool results instead of hardcoded fallback
          forcedFinalization = true;
          // set a safe, non-technical fallback reason to use only if forced-finalization fails
          fallbackReason = 'Извините, я уточню информацию и вернусь с ответом.';
          toolResults.push({ name: call.name, result: null, error: 'Лимит поисковых запросов превышен' });
          break;
        }
      }

      toolsUsed.push(call.name);
      console.log('[TOOL] calling', { agentId, conversationId, name: call.name, args: call.args, trigger: 'model function call' });
      const toolResult = await executeTool(call, toolContext);
      toolResults.push({ name: call.name, result: toolResult.result, error: toolResult.error });
      // accumulate across iterations for possible forced finalization
      accumulatedToolResults.push({ name: call.name, result: toolResult.result, error: toolResult.error });

      if (call.name === 'redirectToOperator' && toolResult.result && !toolResult.error) {
        handoffTriggered = true;
        break;
      }
    }

    if (fallbackReason || handoffTriggered) {
      break;
    }

    if (userMessageId) {
      await admin.from('messages').update({ tool_calls: toolResults }).eq('id', userMessageId);
    }

    const functionResponseParts = toolResults.map((result) => ({
      functionResponse: {
        name: result.name,
        response: result.error ? { error: result.error } : { result: result.result },
      },
    }));

    response = await callGemini(agent.model ?? GEMINI_CHAT_MODEL, compiledPrompt, [
      ...baseContents,
      { role: 'model', parts },
      { role: 'user', parts: functionResponseParts },
    ], allowedToolDeclarations);
    parts = response.payload.parts;
  }

  let finalReply = (parts as Array<Record<string, unknown>>).filter((part) => typeof part?.text === 'string').map((part) => part.text).join('\n').trim();
  let rawReply = finalReply;
  let attempt = 1;
  let tokens_input = response.payload.usageMetadata?.promptTokenCount ?? 0;
  let tokens_output = response.payload.usageMetadata?.candidatesTokenCount ?? 0;
  let validationErrors: string[] = [];

  if (fallbackReason) {
    // when fallbackReason is set we prefer to perform forced-finalization:
    // call Gemini one final time WITHOUT tools, providing accumulated tool results
    if (forcedFinalization) {
      try {
        const summarizedToolParts: Array<{ text: string }> = [];
        for (const r of accumulatedToolResults) {
          try {
            if (r?.name === 'searchKnowledgeBase' && r?.result && typeof r.result === 'object' && Array.isArray((r.result as any).results)) {
              const res = (r.result as any).results as Array<any>;
              const previews = res.slice(0, 3).map((s) => s.content?.slice(0, 800) ?? '').filter(Boolean);
              if (previews.length > 0) {
                summarizedToolParts.push({ text: `Search results (${r.name}):\n${previews.join('\n---\n')}` });
                continue;
              }
            }
            summarizedToolParts.push({ text: `${r?.name}: ${JSON.stringify(r?.result)}` });
          } catch (e) {
            summarizedToolParts.push({ text: `${r?.name}: <unserializable result>` });
          }
        }

        const finalContents = [
          ...baseContents,
          { role: 'model', parts },
          { role: 'user', parts: summarizedToolParts },
          { role: 'system', parts: [{ text: 'Сформулируй ответ клиенту на основе уже найденной информации выше, в human-tone, без упоминания поиска, лимитов или инструментов.' }] },
        ];

        const finalResponse = await callGemini(agent.model ?? GEMINI_CHAT_MODEL, compiledPrompt, finalContents, []);
        const finalParts = finalResponse.payload.parts;
        const finalText = (finalParts as Array<Record<string, unknown>>).filter((part) => typeof part?.text === 'string').map((part) => part.text).join('\n').trim();
        if (finalText) {
          finalReply = finalText;
          rawReply = finalText;
          // override tokens metrics for finalization
          tokens_input += finalResponse.payload.usageMetadata?.promptTokenCount ?? 0;
          tokens_output += finalResponse.payload.usageMetadata?.candidatesTokenCount ?? 0;
        } else {
          finalReply = fallbackReason;
        }
      } catch (e) {
        console.warn('[AGENT] forced finalization failed', e);
        finalReply = fallbackReason;
      }
    } else {
      finalReply = fallbackReason;
    }
  }

  if (handoffTriggered) {
    finalReply = finalReply || 'Сейчас подключу коллегу, пожалуйста, подождите.';
  }

  if (!finalReply) {
    throw new Error('Gemini вернул пустой ответ после обработки инструментов');
  }

  let validation = validateAgentAnswer(finalReply);
  validationErrors = validation.valid ? [] : validation.errors;

  if (!validation.valid && !validationAttempted) {
    validationAttempted = true;
    console.warn('[AGENT] validation failed, retrying once', { agentId, errors: validation.errors });
    const retryResponse = await callGemini(agent.model ?? GEMINI_CHAT_MODEL, compiledPrompt, baseContents, allowedToolDeclarations);
    const retryParts = retryResponse.payload.parts;
    const retryReply = (retryParts as Array<Record<string, unknown>>).filter((part) => typeof part?.text === 'string').map((part) => part.text).join('\n').trim();
    const retryValidation = validateAgentAnswer(retryReply);
    attempt = 2;
    rawReply = retryReply;
    tokens_input += retryResponse.payload.usageMetadata?.promptTokenCount ?? 0;
    tokens_output += retryResponse.payload.usageMetadata?.candidatesTokenCount ?? 0;
    validationErrors = retryValidation.valid ? [] : retryValidation.errors;

    if (retryValidation.valid) {
      finalReply = retryReply;
    } else {
      console.warn('[AGENT] retry validation failed', { agentId, errors: retryValidation.errors });
      finalReply = 'Извините, я уточню информацию и вернусь с ответом.';
    }
  }

  const assistantMessageId = await appendMessage(admin, conversationId, 'ai', finalReply, toolsUsed.map((name) => ({ name })));

  await admin.from('ai_call_logs').insert({
    conversation_id: conversationId,
    request: {
      agent_id: agentId,
      message: userMessage,
      tools_used: toolsUsed,
      iterations,
      validation_errors: validationErrors,
      attempt,
    },
    response: { raw: rawReply, final: finalReply },
    tokens_input,
    tokens_output,
    latency_ms: Date.now() - startTime,
  });

  return {
    answer: finalReply,
    usedChunks: [],
    messageParts: [{ text: finalReply, delayMs: 0 }],
    splitMessages: false,
    typingSimulation: false,
    toolsUsed,
    tokensInput: response.payload.usageMetadata?.promptTokenCount ?? 0,
    tokensOutput: response.payload.usageMetadata?.candidatesTokenCount ?? 0,
    latencyMs: Date.now() - startTime,
  };
}
