import { randomUUID } from 'node:crypto';

export interface BuildNewDialogPayloadOptions {
  agentId: string;
  orgId: string;
  leadName?: string;
  entryNodeId?: string | null;
}

export interface BuildNewDialogPayloadResult {
  lead: {
    org_id: string;
    external_id: string;
    name: string;
    status: 'new';
    ai_enabled: boolean;
    attributes: Record<string, unknown>;
  };
  conversation: {
    agent_id: string;
    current_funnel_step?: string;
  };
}

export function buildNewDialogPayload({
  agentId,
  orgId,
  leadName = 'Новый диалог',
  entryNodeId,
}: BuildNewDialogPayloadOptions): BuildNewDialogPayloadResult {
  return {
    lead: {
      org_id: orgId,
      external_id: `manual:${agentId}:${randomUUID()}`,
      name: leadName,
      status: 'new',
      ai_enabled: true,
      attributes: {},
    },
    conversation: {
      agent_id: agentId,
      ...(entryNodeId ? { current_funnel_step: entryNodeId } : {}),
    },
  };
}
