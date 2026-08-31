import { NextRequest, NextResponse } from 'next/server';
import { createSmartCampaign } from '@/lib/smart-broadcasts/service';
import { getSmartBroadcastOrg } from '@/lib/smart-broadcasts/api-auth';

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = message === 'UNAUTHORIZED' ? 401 : message === 'FORBIDDEN' ? 403 : 400;
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const { user, orgId } = await getSmartBroadcastOrg();
    const body = await req.json();
    if (!body.name || !body.goalInstruction || !body.agentId) return NextResponse.json({ error: 'name, goalInstruction и agentId обязательны' }, { status: 400 });
    const campaign = await createSmartCampaign({
      orgId,
      createdBy: user.id,
      name: body.name,
      goalInstruction: body.goalInstruction,
      audienceFilter: { ...(body.audienceFilter ?? {}), agent_id: body.agentId },
      ...(body.requiresApproval === undefined ? {} : { requiresApproval: Boolean(body.requiresApproval) }),
      ...(body.sendPacingPerMinute === undefined ? {} : { sendPacingPerMinute: Number(body.sendPacingPerMinute) }),
      ...(body.respectWorkHours === undefined ? {} : { respectWorkHours: Boolean(body.respectWorkHours) }),
      ...(body.maxMessageLength === undefined ? {} : { maxMessageLength: Number(body.maxMessageLength) }),
    });
    return NextResponse.json(campaign, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
