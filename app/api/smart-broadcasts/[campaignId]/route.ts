import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getSmartBroadcastOrg } from '@/lib/smart-broadcasts/api-auth';

export async function GET(_req: Request, { params }: { params: { campaignId: string } }) {
  try {
    const { orgId } = await getSmartBroadcastOrg();
    const supabase = createServiceClient();
    const { data: campaign, error } = await supabase.from('smart_campaigns').select('*').eq('id', params.campaignId).eq('org_id', orgId).single();
    if (error || !campaign) return NextResponse.json({ error: 'Кампания не найдена' }, { status: 404 });
    const { data: recipients, error: recipientsError } = await supabase.from('smart_campaign_recipients').select('*, leads(name), lead_signals(signal_type, description, raw_quote)').eq('campaign_id', params.campaignId).order('created_at', { ascending: true });
    if (recipientsError) throw recipientsError;
    return NextResponse.json({ campaign, recipients: recipients ?? [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: message === 'UNAUTHORIZED' ? 401 : message === 'FORBIDDEN' ? 403 : 400 });
  }
}
