import { NextResponse } from 'next/server';
import { approveAllSmartRecipients } from '@/lib/smart-broadcasts/service';
import { getSmartBroadcastOrg } from '@/lib/smart-broadcasts/api-auth';

export async function POST(_req: Request, { params }: { params: { campaignId: string } }) {
  try {
    await getSmartBroadcastOrg();
    return NextResponse.json({ approved: await approveAllSmartRecipients(params.campaignId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: message === 'UNAUTHORIZED' ? 401 : message === 'FORBIDDEN' ? 403 : 400 });
  }
}
