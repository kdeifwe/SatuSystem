import { createServiceClient } from '../../supabase/service.ts';
import { generateQueryEmbedding } from '../embeddings.ts';
import { enqueueNotification } from '../../notifications.ts';
import { sendTelegramNotification } from '../../extensions/telegram-notify.ts';
import { type ToolCall, type ToolResult } from './registry.ts';
import { isSandboxToolAllowed } from './sandbox-allowlist';
import { getLinkedKBChunks } from '../../knowledge-base/search.ts';
import { normalizeFunnelFlow } from '../../funnel/normalize.ts';
import type { FunnelFlow } from '../../funnel/types.ts';

export interface ToolContext {
  leadId: string;
  agentId: string;
  orgId: string;
  conversationId: string;
  isSandbox: boolean;
}

export async function executeTool(call: ToolCall, context: ToolContext): Promise<ToolResult> {
  console.log(`[TOOL] Executing ${call.name}`, { args: call.args, leadId: context.leadId });

  try {
    const result = await dispatch(call, context);
    return { name: call.name, result };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка';
    console.error(`[TOOL] Error in ${call.name}:`, errorMessage);
    return { name: call.name, result: null, error: errorMessage };
  }
}

async function dispatch(call: ToolCall, ctx: ToolContext): Promise<unknown> {
  if (ctx.isSandbox && !isSandboxToolAllowed(call.name)) {
    return {
      sandbox_blocked: true,
      message: `Инструмент ${call.name} недоступен в режиме тестирования`,
    };
  }

  if (!ctx.isSandbox) {
    const { allowedToolNames, hasExplicitAllowList } = await getAllowedToolNamesForAgent(ctx.agentId);
    if (!hasExplicitAllowList || !allowedToolNames.includes(call.name)) {
      await logRejectedToolCall(ctx, call.name, allowedToolNames);
      return {
        rejected: true,
        reason: 'tool_not_allowed',
        tool_name: call.name,
        allowed_tools: allowedToolNames,
      };
    }
  }

  switch (call.name) {
    case 'searchKnowledgeBase':
      return searchKnowledgeBase(call.args as { query: string; top_k?: number }, ctx);
    case 'redirectToOperator':
      return redirectToOperator(call.args as { reason: string; priority?: string }, ctx);
    case 'advanceFunnelStep':
      return advanceFunnelStep(call.args as { stepId: string; reason: string }, ctx);
    case 'getCurrentDate':
      return getCurrentDate(ctx);
    case 'getMediaFiles':
      return getMediaFiles(call.args as { category: string; search_query?: string }, ctx);
    case 'update_lead_status':
      return updateLeadStatus(call.args as { lead_id: string; status: string }, ctx);
    case 'update_lead_info':
      return updateLeadInfo(call.args as { lead_id: string; fields: Record<string, unknown> }, ctx);
    case 'add_lead_note':
      return addLeadNote(call.args as { lead_id: string; note: string }, ctx);
    case 'sendCustomNotification':
      return sendCustomNotification(call.args as { message: string; target: string }, ctx);
    case 'scheduleMessage':
      return scheduleMessage(call.args as { lead_id: string; message: string; send_at: string }, ctx);
    default:
      throw new Error(`Неизвестный инструмент: ${call.name}`);
  }
}

async function getAllowedToolNamesForAgent(agentId: string): Promise<{ allowedToolNames: string[]; hasExplicitAllowList: boolean }> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('agents')
    .select('general_capabilities')
    .eq('id', agentId)
    .maybeSingle();

  if (error) {
    console.warn(`[TOOL] Failed to load allowed_tools for agent ${agentId}`, error.message);
    return { allowedToolNames: [], hasExplicitAllowList: false };
  }

  const generalCapabilities = (data?.general_capabilities as Record<string, unknown> | null) ?? {};
  const hasExplicitAllowList = Object.prototype.hasOwnProperty.call(generalCapabilities, 'allowed_tools');
  const configuredTools = Array.isArray(generalCapabilities.allowed_tools)
    ? (generalCapabilities.allowed_tools as string[]).filter((name): name is string => typeof name === 'string')
    : [];

  return { allowedToolNames: configuredTools, hasExplicitAllowList };
}

async function logRejectedToolCall(ctx: ToolContext, toolName: string, allowedToolNames: string[]) {
  const supabase = createServiceClient();
  try {
    await supabase.from('ai_call_logs').insert({
      conversation_id: ctx.conversationId,
      request: {
        type: 'tool_call_rejected',
        tool_name: toolName,
        agent_id: ctx.agentId,
        reason: 'tool_not_allowed',
      },
      response: {
        rejected: true,
        tool_name: toolName,
        allowed_tools: allowedToolNames,
      },
    });
  } catch (error) {
    console.warn(`[TOOL] Failed to log rejected tool call for ${toolName}`, error);
  }
}

async function searchKnowledgeBase(args: { query: string; top_k?: number }, ctx: ToolContext) {
  const supabase = createServiceClient();
  const topK = Math.min(args.top_k ?? 5, 10);
  const queryEmbedding = await generateQueryEmbedding(args.query);

  const { data, error } = await supabase.rpc('search_knowledge_base', {
    p_agent_id: ctx.agentId,
    query_embedding: queryEmbedding,
    match_count: topK,
    similarity_threshold: 0.3,
  });

  if (error) throw new Error(`Ошибка поиска в базе знаний: ${error.message}`);
  if (!data || data.length === 0) {
    return {
      found: false,
      message: 'В базе знаний не найдено релевантной информации по запросу.',
      query: args.query,
    };
  }

  const primaryChunks = data as Array<{ chunk_id: string; content: string; metadata: unknown; similarity: number; priority: string }>;
  const linkedChunks = await getLinkedKBChunks(primaryChunks.map((chunk) => chunk.chunk_id));
  // Log raw search results for debugging of multi-call flows.
  try {
    console.log('[KB] search result', {
      query: args.query,
      found: primaryChunks.length > 0,
      count: primaryChunks.length,
      top_preview: primaryChunks.slice(0, 3).map((c) => ({ id: c.chunk_id, preview: c.content.slice(0, 200), similarity: c.similarity })),
      linked_preview: linkedChunks.slice(0, 3).map((c) => ({ id: c.id, preview: c.content.slice(0, 200), similarity: c.similarity })),
    });
  } catch (e) {
    console.warn('[KB] failed to log search result', e);
  }

  return {
    found: true,
    count: primaryChunks.length,
    results: primaryChunks.map((chunk) => ({
      content: chunk.content,
      metadata: chunk.metadata,
      relevance: Math.round(chunk.similarity * 100),
      priority: chunk.priority,
    })),
    linked_chunks: linkedChunks.map((chunk) => ({
      id: chunk.id,
      content: chunk.content,
      relevance: Math.round(chunk.similarity * 100),
      link_type: chunk.link_type,
      priority: chunk.priority,
    })),
  };
}

async function redirectToOperator(args: { reason: string; priority?: string }, ctx: ToolContext) {
  if (ctx.isSandbox) {
    await enqueueNotification('operator_needed', ctx.leadId, ctx.agentId, {
      reason: args.reason,
      priority: args.priority ?? 'normal',
    }, { orgId: ctx.orgId, skipDedupCheck: true });
    return { success: true, sandbox_mode: true };
  }

  const supabase = createServiceClient();
  const { error } = await supabase.from('leads').update({ ai_enabled: false }).eq('id', ctx.leadId).eq('org_id', ctx.orgId);
  if (error) throw new Error(`Ошибка передачи оператору: ${error.message}`);

  await supabase.from('lead_notes').insert({
    lead_id: ctx.leadId,
    note: `🔄 AI передал диалог оператору. Причина: ${args.reason}. Приоритет: ${args.priority ?? 'normal'}`,
  });

  await enqueueNotification('operator_needed', ctx.leadId, ctx.agentId, {
    reason: args.reason,
    priority: args.priority ?? 'normal',
  }, { orgId: ctx.orgId });

  return {
    success: true,
    ai_disabled: true,
    priority: args.priority ?? 'normal',
    message: 'Диалог передан оператору. AI отключён для этого клиента.',
  };
}

export function validateFunnelStepId(flow: FunnelFlow | null | undefined, stepId: string): { isValid: boolean; availableStepIds: string[] } {
  const availableStepIds = (flow?.nodes ?? [])
    .map((node) => typeof node?.id === 'string' ? node.id.trim() : '')
    .filter(Boolean);

  return {
    isValid: availableStepIds.includes(stepId),
    availableStepIds,
  };
}

async function advanceFunnelStep(args: { stepId: string; reason: string }, ctx: ToolContext) {
  const supabase = createServiceClient();

  // 1. Получаем dialogue_flow агента и проверяем, что stepId существует
  const { data: agent, error: agentError } = await supabase
    .from('agents')
    .select('dialogue_flow')
    .eq('id', ctx.agentId)
    .single();

  if (agentError || !agent) {
    throw new Error(`Агент не найден: ${ctx.agentId}`);
  }

  const flow = normalizeFunnelFlow(agent.dialogue_flow);
  if (!flow || !Array.isArray(flow.nodes)) {
    throw new Error('Воронка продаж не настроена для этого агента');
  }

  const validation = validateFunnelStepId(flow, args.stepId);
  if (!validation.isValid) {
    const availableSteps = flow.nodes.map((node) => `${node.id} (${node.title})`).join(', ');
    return {
      success: false,
      error: `Шаг "${args.stepId}" не найден в текущей воронке. Доступные шаги: ${availableSteps}`,
      available_steps: flow.nodes.map((node) => ({ id: node.id, title: node.title })),
    };
  }

  // 2. Если валидация прошла, обновляем conversation
  const { data: conversation } = await supabase
    .from('conversations')
    .select('funnel_step_history')
    .eq('id', ctx.conversationId)
    .single();

  const history = [
    ...(Array.isArray(conversation?.funnel_step_history) ? conversation.funnel_step_history : []),
    {
      step_id: args.stepId,
      entered_at: new Date().toISOString(),
      reason: args.reason,
    },
  ];

  const { error } = await supabase
    .from('conversations')
    .update({
      current_funnel_step: args.stepId,
      funnel_step_history: history,
    })
    .eq('id', ctx.conversationId);

  if (error) throw new Error(`Ошибка обновления шага воронки: ${error.message}`);

  const { data: leadData } = await supabase.from('leads').select('attributes').eq('id', ctx.leadId).single();
  const currentAttributes = (leadData?.attributes && typeof leadData.attributes === 'object'
    ? leadData.attributes
    : {}) as Record<string, unknown>;

  const { error: leadError } = await supabase
    .from('leads')
    .update({
      attributes: {
        ...currentAttributes,
        current_node_id: args.stepId,
      },
    })
    .eq('id', ctx.leadId);

  if (leadError) throw new Error(`Ошибка обновления state лида: ${leadError.message}`);

  return {
    success: true,
    step_id: args.stepId,
    reason: args.reason,
  };
}

async function getCurrentDate(ctx: ToolContext) {
  const supabase = createServiceClient();
  const { data: org } = await supabase.from('organizations').select('timezone').eq('id', ctx.orgId).single();
  const timezone = org?.timezone ?? 'Asia/Almaty';
  const now = new Date();

  const formatter = new Intl.DateTimeFormat('ru-RU', {
    timeZone: timezone,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });

  return {
    iso: now.toISOString(),
    formatted: formatter.format(now),
    timezone,
    timestamp: now.getTime(),
  };
}

async function getMediaFiles(args: { category: string; search_query?: string }, ctx: ToolContext) {
  const supabase = createServiceClient();
  let query = supabase.from('kb_sources').select('id, title, metadata').eq('agent_id', ctx.agentId).eq('status', 'done').eq('type', 'file');

  if (args.category !== 'other') {
    query = query.contains('metadata', { category: args.category });
  }

  const { data, error } = await query.limit(5);
  if (error) throw new Error(`Ошибка получения файлов: ${error.message}`);
  if (!data || data.length === 0) {
    return { found: false, message: 'Файлы по запросу не найдены' };
  }

  const filesWithUrls = await Promise.all(
    data.map(async (file: { metadata?: { storage_path?: string }; title?: string }) => {
      const storagePath = file.metadata?.storage_path;
      if (!storagePath) return null;
      const { data: urlData } = await supabase.storage.from('knowledge').createSignedUrl(storagePath, 3600);
      return {
        title: file.title,
        url: urlData?.signedUrl ?? null,
        category: args.category,
      };
    })
  );

  return {
    found: true,
    files: filesWithUrls.filter(Boolean),
  };
}

async function updateLeadStatus(args: { lead_id: string; status: string }, ctx: ToolContext) {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(args.lead_id)) {
    throw new Error('Некорректный lead_id — используй ID лида из контекста диалога, а не из текста сообщения клиента');
  }

  // Игнорируем lead_id из аргументов модели и всегда используем реальный ID
  // текущего лида из контекста диалога — модель не должна сама выбирать,
  // чей статус менять.
  const targetLeadId = ctx.leadId;

  const supabase = createServiceClient();
  const { data: lead, error: leadError } = await supabase.from('leads').select('id, status, org_id').eq('id', targetLeadId).eq('org_id', ctx.orgId).single();
  if (leadError || !lead) throw new Error('Лид не найден или нет доступа');

  if (lead.status === args.status) {
    return { success: true, changed: false, current_status: args.status };
  }

  const { error } = await supabase.from('leads').update({ status: args.status, updated_at: new Date().toISOString() }).eq('id', targetLeadId);
  if (error) throw new Error(`Ошибка обновления статуса: ${error.message}`);

  return {
    success: true,
    changed: true,
    previous_status: lead.status,
    new_status: args.status,
  };
}

async function updateLeadInfo(args: { lead_id: string; fields: Record<string, unknown> }, ctx: ToolContext) {
  const supabase = createServiceClient();
  const SAFE_DIRECT_FIELDS = ['name', 'email'];
  const directUpdate: Record<string, unknown> = {};
  const attributesUpdate: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args.fields)) {
    if (SAFE_DIRECT_FIELDS.includes(key)) {
      directUpdate[key] = value;
    } else {
      attributesUpdate[key] = value;
    }
  }

  const { data: current, error: currentError } = await supabase.from('leads').select('attributes').eq('id', args.lead_id).eq('org_id', ctx.orgId).single();
  if (currentError) throw new Error(`Ошибка получения данных лида: ${currentError.message}`);

  const mergedAttributes = {
    ...(current?.attributes ?? {}),
    ...attributesUpdate,
  };

  const { error } = await supabase.from('leads').update({
    ...directUpdate,
    attributes: mergedAttributes,
    updated_at: new Date().toISOString(),
  }).eq('id', args.lead_id).eq('org_id', ctx.orgId);

  if (error) throw new Error(`Ошибка обновления данных лида: ${error.message}`);

  const phone = args.fields.phone as string | undefined;
  const email = args.fields.email as string | undefined;

  if (phone || email) {
    for (const contactType of ['phone', 'email']) {
      if ((contactType === 'phone' && phone) || (contactType === 'email' && email)) {
        await enqueueNotification('contact_received', args.lead_id, ctx.agentId, {
          phone: contactType === 'phone' ? phone : undefined,
          email: contactType === 'email' ? email : undefined,
          lead_id: args.lead_id,
          lead_name: directUpdate.name || args.fields.name || '—',
        }, { orgId: ctx.orgId });
      }
    }
  }

  return { success: true, updated_fields: Object.keys(args.fields) };
}

async function addLeadNote(args: { lead_id: string; note: string }, ctx: ToolContext) {
  const supabase = createServiceClient();
  const { data: lead, error: leadError } = await supabase.from('leads').select('id').eq('id', args.lead_id).eq('org_id', ctx.orgId).single();
  if (leadError || !lead) throw new Error('Лид не найден или нет доступа');

  const { error } = await supabase.from('lead_notes').insert({
    lead_id: args.lead_id,
    note: `🤖 [AI] ${args.note}`,
    author_id: null,
  });

  if (error) throw new Error(`Ошибка добавления заметки: ${error.message}`);
  return { success: true };
}

async function sendCustomNotification(args: { message: string; target: string }, ctx: ToolContext) {
  const supabase = createServiceClient();

  await supabase.from('messages').insert({
    conversation_id: ctx.conversationId,
    sender: 'system',
    content: `📢 Уведомление команде (${args.target}): ${args.message}`,
  });

  if (ctx.isSandbox) {
    console.log('[TOOL] sendCustomNotification: sandbox mode, skipping Telegram send', {
      conversationId: ctx.conversationId,
      target: args.target,
    });
    return { success: true, telegram_sent: false, reason: 'sandbox_mode' };
  }

  const { data: conversation, error: conversationError } = await supabase
    .from('conversations')
    .select('lead_id')
    .eq('id', ctx.conversationId)
    .single();

  if (conversationError || !conversation?.lead_id) {
    console.warn('[TOOL] sendCustomNotification: unable to resolve lead from conversation', {
      conversationId: ctx.conversationId,
      error: conversationError?.message,
    });
    return { success: true, telegram_sent: false, reason: 'no_recipient' };
  }

  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .select('assigned_to, org_id')
    .eq('id', conversation.lead_id)
    .single();

  if (leadError || !lead) {
    console.warn('[TOOL] sendCustomNotification: unable to resolve lead', {
      leadId: conversation.lead_id,
      error: leadError?.message,
    });
    return { success: true, telegram_sent: false, reason: 'no_recipient' };
  }

  const orgId = lead.org_id;
  let telegramChatIds: string[] = [];

  if (args.target === 'assigned_operator') {
    if (!lead.assigned_to) {
      console.warn('[TOOL] sendCustomNotification: no assigned operator for lead', {
        leadId: conversation.lead_id,
      });
      return { success: true, telegram_sent: false, reason: 'no_recipient' };
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('telegram_chat_id')
      .eq('id', lead.assigned_to)
      .single();

    if (profileError || !profile?.telegram_chat_id) {
      console.warn('[TOOL] sendCustomNotification: assigned operator has no telegram_chat_id', {
        assigned_to: lead.assigned_to,
        error: profileError?.message,
      });
      return { success: true, telegram_sent: false, reason: 'no_recipient' };
    }

    try {
      await sendTelegramNotification(profile.telegram_chat_id, args.message);
      return { success: true, telegram_sent: true, reason: 'sent' };
    } catch (error) {
      console.error('[TOOL] sendCustomNotification: failed to send Telegram notification', error);
      return { success: true, telegram_sent: false, reason: 'send_failed' };
    }
  }

  if (args.target === 'owner') {
    const { data: ownerMember, error: ownerError } = await supabase
      .from('org_members')
      .select('user_id')
      .eq('org_id', orgId)
      .eq('role', 'owner')
      .limit(1)
      .maybeSingle();

    if (ownerError || !ownerMember?.user_id) {
      console.warn('[TOOL] sendCustomNotification: owner not found for org', { orgId, error: ownerError?.message });
      return { success: true, telegram_sent: false, reason: 'no_recipient' };
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('telegram_chat_id')
      .eq('id', ownerMember.user_id)
      .single();

    if (profileError || !profile?.telegram_chat_id) {
      console.warn('[TOOL] sendCustomNotification: owner has no telegram_chat_id', {
        ownerId: ownerMember.user_id,
        error: profileError?.message,
      });
      return { success: true, telegram_sent: false, reason: 'no_recipient' };
    }

    try {
      await sendTelegramNotification(profile.telegram_chat_id, args.message);
      return { success: true, telegram_sent: true, reason: 'sent' };
    } catch (error) {
      console.error('[TOOL] sendCustomNotification: failed to send Telegram notification', error);
      return { success: true, telegram_sent: false, reason: 'send_failed' };
    }
  }

  if (args.target === 'all_team') {
    const { data: members, error: membersError } = await supabase
      .from('org_members')
      .select('user_id')
      .eq('org_id', orgId);

    if (membersError || !members?.length) {
      console.warn('[TOOL] sendCustomNotification: no org members found', { orgId, error: membersError?.message });
      return { success: true, telegram_sent: false, reason: 'no_recipient' };
    }

    const memberIds = members.map((member) => member.user_id).filter(Boolean) as string[];
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('telegram_chat_id')
      .in('id', memberIds)
      .not('telegram_chat_id', 'is', null);

    if (profilesError || !profiles?.length) {
      console.warn('[TOOL] sendCustomNotification: no telegram chat ids for org members', {
        orgId,
        error: profilesError?.message,
      });
      return { success: true, telegram_sent: false, reason: 'no_recipient' };
    }

    telegramChatIds = profiles.map((profile) => profile.telegram_chat_id).filter(Boolean) as string[];
    if (telegramChatIds.length === 0) {
      console.warn('[TOOL] sendCustomNotification: no telegram chat ids available for org members', { orgId });
      return { success: true, telegram_sent: false, reason: 'no_recipient' };
    }

    let delivered = 0;
    let failed = 0;

    for (const chatId of telegramChatIds) {
      try {
        await sendTelegramNotification(chatId, args.message);
        delivered += 1;
      } catch (error) {
        console.error('[TOOL] sendCustomNotification: failed to send Telegram notification', error);
        failed += 1;
      }
    }

    return {
      success: true,
      telegram_sent: delivered > 0,
      delivered,
      failed,
      reason: delivered > 0 ? 'sent' : 'send_failed',
    };
  }

  console.warn('[TOOL] sendCustomNotification: unknown target', { target: args.target });
  return { success: true, telegram_sent: false, reason: 'unknown_target' };
}

async function scheduleMessage(args: { lead_id: string; message: string; send_at: string }, ctx: ToolContext) {
  const supabase = createServiceClient();
  const sendAt = new Date(args.send_at);
  if (Number.isNaN(sendAt.getTime())) throw new Error('Некорректный формат времени send_at');
  if (sendAt.getTime() < Date.now()) throw new Error('Время отправки не может быть в прошлом');

  await supabase.from('messages').insert({
    conversation_id: ctx.conversationId,
    sender: 'system',
    content: `⏰ Запланированное сообщение для ${args.lead_id}: ${args.message}`,
    origin: 'followup',
  });

  return {
    success: true,
    send_at: args.send_at,
    lead_id: args.lead_id,
  };
}
