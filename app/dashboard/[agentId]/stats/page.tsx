'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { StatsHeader } from '@/components/dashboard/stats/StatsHeader';
import { FilterPanel } from '@/components/dashboard/stats/FilterPanel';
import { ResultsBlock } from '@/components/dashboard/stats/ResultsBlock';
import { EngagementBlock } from '@/components/dashboard/stats/EngagementBlock';
import { SpeedCoverageBlock } from '@/components/dashboard/stats/SpeedCoverageBlock';
import { TrendsBlock } from '@/components/dashboard/stats/TrendsBlock';
import { SourcesBlock } from '@/components/dashboard/stats/SourcesBlock';
import { TeamBlock } from '@/components/dashboard/stats/TeamBlock';
import { InsightsBlock } from '@/components/dashboard/stats/InsightsBlock';
import { useStats } from '@/hooks/useStats';
import { createClient } from '@/lib/supabase/client';


export default function StatsPage() {
  const params = useParams();
  const agentId = params.agentId as string;
  const [channels, setChannels] = useState<string[]>([]);
  const [campaigns, setCampaigns] = useState<string[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(true);

  const { data, loading, error, filters, updateFilters } = useStats(agentId);

  // Fetch channels and campaigns on mount
  useEffect(() => {
    const fetchMetadata = async () => {
      try {
        const supabase = createClient();

        // Get agent's org_id first
        const { data: agentRow, error: agentErr } = await supabase
          .from('agents')
          .select('org_id')
          .eq('id', agentId)
          .single();

        if (agentErr) {
          console.error('Failed to load agent row:', agentErr);
          setChannels([]);
          setCampaigns([]);
          return;
        }

        const orgId = agentRow?.org_id;

        // Channels: filter by org_id (channels table has no agent_id)
        const { data: channelData } = await supabase
          .from('channels')
          .select('type')
          .eq('org_id', orgId);

        const channelTypes = [...new Set(
          channelData
            ?.map((c: any) => c.type)
            .filter(Boolean) as string[] || []
        )] as string[];
        setChannels(channelTypes);

        // Campaigns: find lead_ids from conversations for this agent, then fetch leads.campaign
        const { data: convRows } = await supabase
          .from('conversations')
          .select('lead_id')
          .eq('agent_id', agentId);

        const leadIds = [...new Set((convRows ?? []).map((c: any) => c.lead_id).filter(Boolean))];

        let campaignNames: string[] = [];
        if (leadIds.length) {
          const { data: leadRows } = await supabase
            .from('leads')
            .select('campaign')
            .in('id', leadIds);

          campaignNames = [...new Set(
            leadRows
              ?.map((l: any) => l.campaign)
              .filter(Boolean) as string[] || []
          )] as string[];
        } else {
          // Fallback: get campaigns for org if no conversations for this agent
          const { data: leadRows } = await supabase
            .from('leads')
            .select('campaign')
            .eq('org_id', orgId);

          campaignNames = [...new Set(
            leadRows
              ?.map((l: any) => l.campaign)
              .filter(Boolean) as string[] || []
          )] as string[];
        }

        setCampaigns(campaignNames);
      } catch (err) {
        console.error('Failed to fetch metadata:', err);
      } finally {
        setChannelsLoading(false);
      }
    };

    if (agentId) {
      fetchMetadata();
    }
  }, [agentId]);

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-8">
        <StatsHeader />
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          Ошибка при загрузке статистики: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-full max-w-7xl px-6 py-8">
      <StatsHeader />
      
      <FilterPanel
        filters={filters}
        channels={channels}
        campaigns={campaigns}
        agentId={agentId}
        onFilterChange={updateFilters}
      />

      {/* Progressive rendering - each block loads independently */}
      <ResultsBlock data={data} loading={loading} />
      <EngagementBlock data={data} loading={loading} />
      <SpeedCoverageBlock data={data} loading={loading} />
      <TrendsBlock data={data} loading={loading} />
      <SourcesBlock data={data} loading={loading} />
      <TeamBlock data={data} loading={loading} />
      <InsightsBlock />
    </div>
  );
}
