import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import SmartBroadcastsClientPage from './smart-broadcasts-client';

export default async function BroadcastsPage({ params }: { params: { agentId: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const service = createServiceClient();
  const { data: agent } = await service.from('agents').select('id, org_id').eq('id', params.agentId).maybeSingle();

  if (!agent?.org_id) {
    return <div className="p-6 text-[color:var(--color-smoke)]">Агент не найден.</div>;
  }

  const [signalsResult, campaignsResult, completedApprovalCampaignResult, leadsResult] = await Promise.all([
    service.from('lead_signals').select('id, lead_id, signal_type, description, raw_quote, status, created_at, leads(name, status)').eq('org_id', agent.org_id).order('created_at', { ascending: false }),
    service.from('smart_campaigns').select('id, name, status, requires_approval, created_at').eq('org_id', agent.org_id).order('created_at', { ascending: false }),
    service.from('smart_campaigns').select('id').eq('org_id', agent.org_id).eq('requires_approval', true).eq('status', 'done').limit(1).maybeSingle(),
    service.from('leads').select('id, name, status, external_id').eq('org_id', agent.org_id).order('name', { ascending: true }),
  ]);

  const canToggleApproval = Boolean(completedApprovalCampaignResult.data?.id);
  const initialSignals = (signalsResult.data ?? []).map((signal: Record<string, unknown>) => ({
    id: signal.id as string,
    lead_id: signal.lead_id as string,
    lead_name: ((signal.leads as { name?: string | null } | null)?.name) ?? null,
    lead_status: ((signal.leads as { status?: string | null } | null)?.status) ?? null,
    signal_type: signal.signal_type as string,
    description: signal.description as string,
    raw_quote: signal.raw_quote as string | null | undefined,
    status: signal.status as string,
    created_at: signal.created_at as string,
  }));

  const initialLeads = (leadsResult.data ?? []).map((lead: Record<string, unknown>) => ({
    id: lead.id as string,
    name: (lead.name as string | null) ?? 'Без имени',
    status: (lead.status as string | null) ?? 'unknown',
    external_id: (lead.external_id as string | null) ?? null,
  }));

  return <SmartBroadcastsClientPage agentId={params.agentId} initialSignals={initialSignals as Array<{ id: string; lead_id: string; lead_name?: string | null; lead_status?: string | null; signal_type: string; description: string; raw_quote?: string | null; status: string; created_at: string }>} initialCampaigns={(campaignsResult.data ?? []) as Array<{ id: string; name: string; status: string; requires_approval: boolean; created_at: string }>} initialCanToggleApproval={canToggleApproval} initialLeads={initialLeads} />;
}
