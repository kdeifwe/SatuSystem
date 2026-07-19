'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { ChevronDown, Settings, Download } from 'lucide-react';
import { StatsFilters, Period, Outcome } from '@/hooks/useStats';
import { Card } from '@/components/ui/card';

interface FilterPanelProps {
  filters: StatsFilters;
  channels: string[];
  campaigns: string[];
  agentId: string;
  onFilterChange: (filters: Partial<StatsFilters>) => void;
}

export const FilterPanel = ({
  filters,
  channels,
  campaigns,
  agentId,
  onFilterChange,
}: FilterPanelProps) => {
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const periodLabels: Record<Period, string> = {
    day: 'День',
    week: 'Неделя',
    month: 'Месяц',
    custom: 'Свой',
  };

  const outcomeOptions = [
    { value: 'all', label: 'Все исходы' },
    { value: 'goal', label: 'Цель достигнута' },
    { value: 'undefined_close', label: 'Закрыт без исхода' },
    { value: 'no_response', label: 'Без ответа клиента' },
    { value: 'open', label: 'Открыт' },
  ];

  const getOutcomeLabel = () => {
    return (
      outcomeOptions.find(o => o.value === (filters.outcome || 'all'))?.label ||
      'Все исходы'
    );
  };

  const dateRangeText = filters.from && filters.to ? 
    `${format(filters.from, 'dd.MM')} – ${format(filters.to, 'dd.MM.yyyy')}` : 
    '';

  const handleExport = async () => {
    setIsExporting(true);

    try {
      const params = new URLSearchParams({
        period: filters.period,
        agent_id: agentId,
      });

      if (filters.from) params.set('from', filters.from.toISOString());
      if (filters.to) params.set('to', filters.to.toISOString());
      if (filters.channel) params.set('channel', filters.channel);
      if (filters.campaign) params.set('campaign', filters.campaign);
      if (filters.outcome && filters.outcome !== 'all') {
        params.set('outcome', filters.outcome);
      }

      const response = await fetch(`/api/stats/export?${params.toString()}`);
      if (!response.ok) {
        throw new Error('Не удалось выгрузить статистику');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `stats-${agentId}.xlsx`;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export failed', error);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Card className="mb-6 border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] p-4">
      <div className="flex items-center gap-3 overflow-x-auto pb-2">
        {/* Settings button */}
        <button className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 hover:bg-gray-50 whitespace-nowrap text-sm font-medium">
          <Settings size={16} />
          Настройки аналитики
        </button>

        {/* Period selector */}
        <div className="relative">
          <button className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 hover:bg-gray-50 whitespace-nowrap text-sm font-medium">
            Период: {periodLabels[filters.period]}
            <ChevronDown size={16} />
          </button>
          <div className="absolute top-full mt-1 left-0 bg-white border border-gray-200 rounded-lg shadow-lg z-10 min-w-40 hidden group-hover:block">
            {Object.entries(periodLabels).map(([key, label]) => (
              <button
                key={key}
                onClick={() => onFilterChange({ period: key as Period })}
                className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 ${
                  filters.period === key ? 'bg-blue-50 text-blue-600 font-medium' : ''
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Outcome selector */}
        <div className="relative">
          <button className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 hover:bg-gray-50 whitespace-nowrap text-sm font-medium">
            {getOutcomeLabel()}
            <ChevronDown size={16} />
          </button>
          <div className="absolute top-full mt-1 left-0 bg-white border border-gray-200 rounded-lg shadow-lg z-10 min-w-48 hidden group-hover:block">
            {outcomeOptions.map(option => (
              <button
                key={option.value}
                onClick={() =>
                  onFilterChange({
                    outcome: option.value as Outcome,
                  })
                }
                className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 ${
                  (filters.outcome || 'all') === option.value
                    ? 'bg-blue-50 text-blue-600 font-medium'
                    : ''
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* Channel selector */}
        {channels.length > 0 && (
          <div className="relative">
            <button className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 hover:bg-gray-50 whitespace-nowrap text-sm font-medium">
              {filters.channel ? `${filters.channel}` : 'Все каналы'}
              <ChevronDown size={16} />
            </button>
            <div className="absolute top-full mt-1 left-0 bg-white border border-gray-200 rounded-lg shadow-lg z-10 min-w-40 hidden group-hover:block">
              <button
                onClick={() => onFilterChange({ channel: undefined })}
                className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 ${
                  !filters.channel ? 'bg-blue-50 text-blue-600 font-medium' : ''
                }`}
              >
                Все каналы
              </button>
              {channels.map(channel => (
                <button
                  key={channel}
                  onClick={() => onFilterChange({ channel })}
                  className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 ${
                    filters.channel === channel
                      ? 'bg-blue-50 text-blue-600 font-medium'
                      : ''
                  }`}
                >
                  {channel}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Campaign selector */}
        {campaigns.length > 0 && (
          <div className="relative">
            <button className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 hover:bg-gray-50 whitespace-nowrap text-sm font-medium">
              {filters.campaign ? `${filters.campaign}` : 'Все кампании'}
              <ChevronDown size={16} />
            </button>
            <div className="absolute top-full mt-1 left-0 bg-white border border-gray-200 rounded-lg shadow-lg z-10 min-w-40 hidden group-hover:block max-h-48 overflow-y-auto">
              <button
                onClick={() => onFilterChange({ campaign: undefined })}
                className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 ${
                  !filters.campaign ? 'bg-blue-50 text-blue-600 font-medium' : ''
                }`}
              >
                Все кампании
              </button>
              {campaigns.map(campaign => (
                <button
                  key={campaign}
                  onClick={() => onFilterChange({ campaign })}
                  className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 ${
                    filters.campaign === campaign
                      ? 'bg-blue-50 text-blue-600 font-medium'
                      : ''
                  }`}
                >
                  {campaign || '(Без кампании)'}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Date range */}
        {filters.period === 'custom' && dateRangeText && (
          <div className="px-3 py-2 rounded-lg border border-gray-300 text-sm whitespace-nowrap">
            {dateRangeText}
          </div>
        )}

        {/* Export button */}
        <button
          type="button"
          onClick={handleExport}
          disabled={isExporting}
          className="ml-auto flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 hover:bg-gray-50 whitespace-nowrap text-sm font-medium disabled:opacity-60"
        >
          <Download size={16} />
          {isExporting ? 'Выгружаю…' : 'Выгрузить'}
        </button>
      </div>
    </Card>
  );
};
