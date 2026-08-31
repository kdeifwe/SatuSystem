import { NextRequest, NextResponse } from 'next/server';
import { approveSmartRecipient } from '@/lib/smart-broadcasts/service';
import { getSmartBroadcastOrg } from '@/lib/smart-broadcasts/api-auth';

export async function POST(req: NextRequest, { params }: { params: { campaignId: string; recipientId: string } }) {
  try {
    const { orgId } = await getSmartBroadcastOrg();
    const body = await req.json().catch(() => ({}));
    return NextResponse.json(await approveSmartRecipient(params.campaignId, params.recipientId, orgId, body.editedMessage));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: message === 'UNAUTHORIZED' ? 401 : message === 'FORBIDDEN' ? 403 : 400 });
  }
}
