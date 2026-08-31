import { NextResponse } from 'next/server';
import { generateSmartCampaign } from '@/lib/smart-broadcasts/service';
import { getSmartBroadcastOrg } from '@/lib/smart-broadcasts/api-auth';

export async function POST(_req: Request, { params }: { params: { campaignId: string } }) {
  try {
    const { orgId } = await getSmartBroadcastOrg();
    return NextResponse.json(await generateSmartCampaign(params.campaignId, orgId));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: message === 'UNAUTHORIZED' ? 401 : message === 'FORBIDDEN' ? 403 : 400 });
  }
}
