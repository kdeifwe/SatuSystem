import { useCallback, useState, useEffect } from 'react';
import { subDays, subWeeks, startOfMonth, startOfDay, endOfDay } from 'date-fns';

export type Period = 'day' | 'week' | 'month' | 'custom';
export type Outcome = 'all' | 'goal' | 'undefined_close' | 'no_response' | 'open';

export interface StatsFilters {
  period: Period;
  from?: Date;
  to?: Date;
  channel?: string;
  campaign?: string;
  outcome?: Outcome;
}

export interface StatsData {
  dialog_count: number;
  dialog_count_previous: number;
  dialog_count_change_pct: number | null;
  conversion: {
    count: number;
    pct: number | null;
    x: number;
    y: number;
  };
  undefined_close: {
    count: number;
    pct: number | null;
  };
  no_response: {
    count: number;
    pct: number | null;
  };
  ai_messages: {
    count: number;
    main: number;
    followup: number;
    previous_count: number;
    change_pct: number | null;
  };
  avg_client_messages_per_conversation: number | null;
  avg_ai_messages_per_conversation: number | null;
  avg_ai_response_time_ms: number | null;
  avg_operator_response_time_ms: number | null;
  handoff: {
    count: number;
    pct: number | null;
  };
  trends: {
    conversations: Array<{ day: string; value: number }>;
    conversion: Array<{ day: string; value: number }>;
  };
  sources: Array<{
    source: string;
    count: number;
    conversion_count: number;
    conversion_pct: number | null;
  }>;
  team: Array<{
    assigned_to: string | null;
    operator_name: string | null;
    assigned_leads: number;
    handled_chats: number;
    operator_messages: number;
    avg_response_ms: number | null;
  }>;
}

const resolvePeriodBounds = (period: Period, from?: Date, to?: Date) => {
  const end = to ? endOfDay(to) : endOfDay(new Date());
  
  switch (period) {
    case 'day':
      return { from: startOfDay(new Date()), to: end };
    case 'week':
      return { from: startOfDay(subWeeks(new Date(), 1)), to: end };
    case 'month':
      return { from: startOfMonth(new Date()), to: end };
    case 'custom':
      return { from: from ? startOfDay(from) : startOfDay(new Date()), to: end };
    default:
      return { from: startOfMonth(new Date()), to: end };
  }
};

export const useStats = (agentId: string | null) => {
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<StatsFilters>({
    period: 'month',
  });

  const fetchStats = useCallback(async (filtersToUse: StatsFilters = filters) => {
    if (!agentId) return;

    setLoading(true);
    setError(null);

    try {
      const { from, to } = resolvePeriodBounds(
        filtersToUse.period,
        filtersToUse.from,
        filtersToUse.to
      );

      const params = new URLSearchParams({
        period: filtersToUse.period,
        from: from.toISOString(),
        to: to.toISOString(),
        agent_id: agentId,
      });

      if (filtersToUse.channel) params.append('channel', filtersToUse.channel);
      if (filtersToUse.campaign) params.append('campaign', filtersToUse.campaign);
      if (filtersToUse.outcome && filtersToUse.outcome !== 'all') {
        params.append('outcome', filtersToUse.outcome);
      }

      const res = await fetch(`/api/stats?${params}`);
      if (!res.ok) throw new Error('Failed to fetch stats');

      const statsData = await res.json();
      setData(statsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [agentId, filters]);

  const updateFilters = useCallback((newFilters: Partial<StatsFilters>) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
  }, []);

  useEffect(() => {
    fetchStats();
  }, [agentId, filters.period, filters.from, filters.to, filters.channel, filters.campaign, filters.outcome]);

  return { data, loading, error, filters, updateFilters };
};
