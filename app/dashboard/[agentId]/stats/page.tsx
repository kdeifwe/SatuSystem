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

        // Get channels
        const { data: channelData } = await supabase
          .from('channels')
          .select('type')
          .eq('agent_id', agentId);

        const channelTypes = [...new Set(
          channelData
            ?.map(c => c.type)
            .filter(Boolean) as string[] || []
        )] as string[];
        setChannels(channelTypes);

        // Get campaigns
        const { data: campaignData } = await supabase
          .from('leads')
          .select('campaign')
          .eq('agent_id', agentId);

        const campaignNames = [...new Set(
          campaignData
            ?.map(c => c.campaign)
            .filter(Boolean) as string[] || []
        )] as string[];
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
    <div className="max-w-7xl mx-auto px-6 py-8">
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
