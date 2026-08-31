import { randomUUID } from 'node:crypto';
import { GEMINI_CHAT_MODEL } from '../lib/server/ai/gemini-client';

const ALLOWED_ISOLATION_PREFIXES = ['sb-'];

export interface IsolatedSmartBroadcastTestContext {
  orgId: string;
  orgName: string;
  agentId: string;
  agentName: string;
}

export function assertIsolatedSmartBroadcastTestContext(context: IsolatedSmartBroadcastTestContext): void {
  const isAllowedOrg = ALLOWED_ISOLATION_PREFIXES.some((prefix) => context.orgName.toLowerCase().startsWith(prefix));
  const isAllowedAgent = ALLOWED_ISOLATION_PREFIXES.some((prefix) => context.agentName.toLowerCase().startsWith(prefix));

  if (!isAllowedOrg || !isAllowedAgent) {
    throw new Error(
      `Unsafe smart-broadcast test context: orgName="${context.orgName}" agentName="${context.agentName}". ` +
      'Test scripts must use a generated isolated context with names starting with "sb-isolated-" or "sb-repeated-".',
    );
  }
}

export async function createIsolatedSmartBroadcastTestContext(
  admin: { from: (table: string) => any },
  options?: {
    orgName?: string;
    agentName?: string;
    model?: string;
  },
): Promise<IsolatedSmartBroadcastTestContext> {
  const orgName = options?.orgName ?? `sb-isolated-test-${Date.now()}`;
  const agentName = options?.agentName ?? 'sb-isolated-agent';
  const model = options?.model ?? GEMINI_CHAT_MODEL;

  if (!ALLOWED_ISOLATION_PREFIXES.some((prefix) => orgName.toLowerCase().startsWith(prefix))) {
    throw new Error(`Unsafe orgName "${orgName}" for smart-broadcast test. It must start with one of: ${ALLOWED_ISOLATION_PREFIXES.join(', ')}`);
  }

  if (!ALLOWED_ISOLATION_PREFIXES.some((prefix) => agentName.toLowerCase().startsWith(prefix))) {
    throw new Error(`Unsafe agentName "${agentName}" for smart-broadcast test. It must start with one of: ${ALLOWED_ISOLATION_PREFIXES.join(', ')}`);
  }

  const { data: orgInsert, error: orgError } = await admin.from('organizations').insert({ name: orgName }).select('id').single();
  if (orgError || !orgInsert) {
    throw new Error(`Failed to create isolated org "${orgName}": ${orgError?.message ?? 'unknown error'}`);
  }

  const agentId = randomUUID();
  const { data: agentInsert, error: agentError } = await admin.from('agents').insert({
    id: agentId,
    org_id: orgInsert.id,
    name: agentName,
    role: 'консультант',
    tone_of_voice: 'тёплый и деловой',
    human_communication_style: 'живой стиль, один вопрос за раз',
    dialogue_flow: null,
    general_capabilities: { allowed_tools: ['recordLeadSignal'] },
    model,
    system_prompt_compiled: 'Тестовый агент для проверки генерации умной рассылки.',
    is_active: true,
  }).select('id').single();

  if (agentError || !agentInsert) {
    throw new Error(`Failed to create isolated agent "${agentName}" in org "${orgName}": ${agentError?.message ?? 'unknown error'}`);
  }

  return {
    orgId: orgInsert.id as string,
    orgName,
    agentId,
    agentName,
  };
}
