import { buildAgentPatchPayload, canManageAgentRole, hasPromptAffectingChanges } from './access';
import { GEMINI_CHAT_MODEL } from '@/lib/server/ai/gemini-client';

export interface AgentRouteDependencies {
  supabase: any;
  compileAndSaveSystemPrompt?: (agentId: string) => Promise<unknown>;
}

interface AgentRouteResult {
  status: number;
  body: Record<string, unknown>;
}

interface AgentRouteRequest {
  json?: () => Promise<Record<string, unknown>>;
}

interface AgentRouteParams {
  agentId: string;
}

async function getAuthenticatedUser(supabase: any) {
  const { data: { user } } = await supabase.auth.getUser();
  return user ?? null;
}

async function getMembership(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from('org_members')
    .select('org_id, role')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

function getDefaultAllowedTools(organization: Record<string, unknown> | null | undefined) {
  const defaults = (organization?.agent_defaults as Record<string, unknown> | null) ?? {};
  const defaultAllowedTools = Array.isArray(defaults.default_allowed_tools)
    ? defaults.default_allowed_tools.filter((tool): tool is string => typeof tool === 'string')
    : ['searchKnowledgeBase', 'redirectToOperator', 'advanceFunnelStep', 'getCurrentDate', 'add_lead_note'];

  return defaultAllowedTools;
}

export async function handleAgentCreate({ supabase, compileAndSaveSystemPrompt }: AgentRouteDependencies): Promise<AgentRouteResult> {
  const user = await getAuthenticatedUser(supabase);
  if (!user) {
    return { status: 401, body: { error: 'Не авторизован' } };
  }

  try {
    const membership = await getMembership(supabase, user.id);
    if (!membership) {
      return { status: 403, body: { error: 'Доступ к организации запрещён' } };
    }

    const { data: organization, error: organizationError } = await supabase
      .from('organizations')
      .select('agent_defaults')
      .eq('id', membership.org_id)
      .maybeSingle();

    if (organizationError) {
      return { status: 500, body: { error: organizationError.message } };
    }

    const defaultAllowedTools = getDefaultAllowedTools(organization as Record<string, unknown> | null | undefined);
    const initialCommunicationStyle = typeof (organization as Record<string, unknown> | null)?.human_communication_style === 'string'
      ? (organization as Record<string, unknown>).human_communication_style as string
      : null;
    const initialKnowledgeBasePrinciples = typeof (organization as Record<string, unknown> | null)?.knowledge_base_principles === 'string'
      ? (organization as Record<string, unknown>).knowledge_base_principles as string
      : null;

    const { data, error } = await supabase
      .from('agents')
      .insert({
        name: 'Новый агент',
        role: 'assistant',
        goal: 'Помощник',
        goal_status: 'active',
        undefined_close_statuses: ['not_interested', 'no_response'],
        response_wait_hours: 24,
        org_id: membership.org_id,
        model: GEMINI_CHAT_MODEL,
        is_active: true,
        updated_at: new Date().toISOString(),
        human_communication_style: initialCommunicationStyle,
        knowledge_base_principles: initialKnowledgeBasePrinciples,
        general_capabilities: {
          allowed_tools: defaultAllowedTools,
        },
      })
      .select('id')
      .single();

    if (error) {
      return { status: 500, body: { error: error.message } };
    }

    if (compileAndSaveSystemPrompt) {
      await compileAndSaveSystemPrompt(data.id);
    }

    return { status: 200, body: { agentId: data.id } };
  } catch (err) {
    return { status: 500, body: { error: (err as Error).message } };
  }
}

export async function handleAgentRoute(
  method: 'GET' | 'PATCH' | 'DELETE',
  req: AgentRouteRequest | undefined,
  params: AgentRouteParams,
  { supabase, compileAndSaveSystemPrompt }: AgentRouteDependencies,
): Promise<AgentRouteResult> {
  const user = await getAuthenticatedUser(supabase);
  if (!user) {
    return { status: 401, body: { error: 'Не авторизован' } };
  }

  try {
    const membership = await getMembership(supabase, user.id);
    if (!membership) {
      return { status: 403, body: { error: 'Доступ к организации запрещён' } };
    }

    if (method === 'GET') {
      const { data, error } = await supabase
        .from('agents')
        .select('id, name, role, goal, goal_status, undefined_close_statuses, response_wait_hours, tone_of_voice, temperature, top_p, model, communication_rules, human_communication_style, knowledge_base_principles, dialogue_flow, system_prompt_compiled, general_capabilities, is_active, created_at, updated_at')
        .eq('id', params.agentId)
        .maybeSingle();

      if (error) return { status: 500, body: { error: error.message } };
      if (!data) return { status: 404, body: { error: 'Агент не найден' } };
      return { status: 200, body: data };
    }

    if (!canManageAgentRole(membership.role)) {
      return {
        status: 403,
        body: {
          error: method === 'DELETE' ? 'Только владелец или администратор может удалить агента' : 'Только владелец или администратор может менять агента',
        },
      };
    }

    if (method === 'PATCH') {
      let body: Record<string, unknown> = {};
      if (req?.json) {
        try {
          body = await req.json();
        } catch {
          return { status: 400, body: { error: 'Неверный JSON' } };
        }
      }

      const updates = buildAgentPatchPayload(body);
      if (Object.keys(updates).length === 0) {
        return { status: 400, body: { error: 'Нет допустимых полей для обновления' } };
      }

      const { error } = await supabase
        .from('agents')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq('id', params.agentId);

      if (error) return { status: 500, body: { error: error.message } };

      if (compileAndSaveSystemPrompt && hasPromptAffectingChanges(body)) {
        await compileAndSaveSystemPrompt(params.agentId);
      }

      return { status: 200, body: { success: true } };
    }

    if (method === 'DELETE') {
      const { error } = await supabase.from('agents').delete().eq('id', params.agentId);
      if (error) return { status: 500, body: { error: error.message } };
      return { status: 200, body: { success: true } };
    }

    return { status: 405, body: { error: 'Метод не поддерживается' } };
  } catch (err) {
    return { status: 500, body: { error: (err as Error).message } };
  }
}
