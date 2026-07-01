import { createServiceClient } from '../../supabase/service.ts';
import { generateEmbedding } from '../embeddings.ts';
import { type ToolCall, type ToolResult } from './registry.ts';

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
  if (ctx.isSandbox && call.name !== 'searchKnowledgeBase' && call.name !== 'getCurrentDate') {
    return {
      sandbox_blocked: true,
      message: `Инструмент ${call.name} недоступен в режиме тестирования`,
    };
  }

  switch (call.name) {
    case 'searchKnowledgeBase':
      return searchKnowledgeBase(call.args as { query: string; top_k?: number }, ctx);
    case 'redirectToOperator':
      return redirectToOperator(call.args as { reason: string; priority?: string }, ctx);
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

async function searchKnowledgeBase(args: { query: string; top_k?: number }, ctx: ToolContext) {
  const supabase = createServiceClient();
  const topK = Math.min(args.top_k ?? 5, 10);
  const queryEmbedding = await generateEmbedding(args.query);

  const { data, error } = await supabase.rpc('match_kb_chunks', {
    query_embedding: queryEmbedding,
    match_threshold: 0.65,
    match_count: topK,
    p_agent_id: ctx.agentId,
  });

  if (error) throw new Error(`Ошибка поиска в базе знаний: ${error.message}`);
  if (!data || data.length === 0) {
    return {
      found: false,
      message: 'В базе знаний не найдено релевантной информации по запросу.',
      query: args.query,
    };
  }

  return {
    found: true,
    count: data.length,
    results: data.map((chunk: { content: string; metadata: unknown; similarity: number }) => ({
      content: chunk.content,
      metadata: chunk.metadata,
      relevance: Math.round(chunk.similarity * 100),
    })),
  };
}

async function redirectToOperator(args: { reason: string; priority?: string }, ctx: ToolContext) {
  if (ctx.isSandbox) {
    return { success: true, sandbox_mode: true };
  }

  const supabase = createServiceClient();
  const { error } = await supabase.from('leads').update({ ai_enabled: false }).eq('id', ctx.leadId).eq('org_id', ctx.orgId);
  if (error) throw new Error(`Ошибка передачи оператору: ${error.message}`);

  await supabase.from('lead_notes').insert({
    lead_id: ctx.leadId,
    note: `🔄 AI передал диалог оператору. Причина: ${args.reason}. Приоритет: ${args.priority ?? 'normal'}`,
  });

  return {
    success: true,
    ai_disabled: true,
    priority: args.priority ?? 'normal',
    message: 'Диалог передан оператору. AI отключён для этого клиента.',
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
  const supabase = createServiceClient();
  const { data: lead, error: leadError } = await supabase.from('leads').select('id, status, org_id').eq('id', args.lead_id).eq('org_id', ctx.orgId).single();
  if (leadError || !lead) throw new Error('Лид не найден или нет доступа');

  if (lead.status === args.status) {
    return { success: true, changed: false, current_status: args.status };
  }

  const { error } = await supabase.from('leads').update({ status: args.status, updated_at: new Date().toISOString() }).eq('id', args.lead_id);
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
  return { success: true, target: args.target };
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
  });

  return {
    success: true,
    send_at: args.send_at,
    lead_id: args.lead_id,
  };
}
