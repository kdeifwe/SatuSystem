export const AGENT_PATCH_FIELDS = [
  'name',
  'role',
  'goal',
  'goal_status',
  'undefined_close_statuses',
  'response_wait_hours',
  'tone_of_voice',
  'temperature',
  'top_p',
  'model',
  'communication_rules',
  'human_communication_style',
  'knowledge_base_principles',
  'dialogue_flow',
  'general_capabilities',
  'is_active',
] as const;

export const PROMPT_AFFECTING_FIELDS = [
  'name',
  'role',
  'goal',
  'goal_status',
  'undefined_close_statuses',
  'response_wait_hours',
  'tone_of_voice',
  'temperature',
  'top_p',
  'model',
  'communication_rules',
  'human_communication_style',
  'knowledge_base_principles',
  'dialogue_flow',
  'general_capabilities',
] as const;

export function buildAgentPatchPayload(body: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const updates: Record<string, unknown> = {};

  if (!body || typeof body !== 'object') {
    return updates;
  }

  for (const key of AGENT_PATCH_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      updates[key] = body[key];
    }
  }

  return updates;
}

export function hasPromptAffectingChanges(body: Record<string, unknown> | null | undefined): boolean {
  const updates = buildAgentPatchPayload(body);
  return Object.keys(updates).some((key) => PROMPT_AFFECTING_FIELDS.includes(key as (typeof PROMPT_AFFECTING_FIELDS)[number]));
}

export function canManageAgentRole(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'admin';
}
