'use client';

import { Info } from 'lucide-react';
import { StatsData } from '@/hooks/useStats';
import * as React from 'react';

interface SpeedCoverageBlockProps {
  data: StatsData | null;
  loading: boolean;
}

const Tooltip = ({ text, children }: { text: string; children: React.ReactNode }) => {
  const [show, setShow] = React.useState(false);
  return (
    <div className="relative inline-block">
      <div
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        className="cursor-help"
      >
        {children}
      </div>
      {show && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-20">
          {text}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
        </div>
      )}
    </div>
  );
};

const formatTime = (ms: number | null): string => {
  if (ms === null || ms === undefined) return 'N/A';
  if (ms === 0) return 'N/A';
  
  const seconds = ms / 1000;
  if (seconds < 60) return `${Math.round(seconds)}с`;
  
  const minutes = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${minutes}м ${secs}с`;
};

const MetricCard = ({
  title,
  value,
  tooltip,
  loading,
}: {
  title: string;
  value: string;
  tooltip: string;
  loading: boolean;
}) => {
  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="h-5 w-32 bg-gray-200 rounded animate-pulse"></div>
          <Info size={16} className="text-gray-400" />
        </div>
        <div className="h-8 w-24 bg-gray-200 rounded animate-pulse"></div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-gray-700">{title}</h3>
        <Tooltip text={tooltip}>
          <Info size={16} className="text-gray-400 hover:text-gray-600" />
        </Tooltip>
      </div>
      <div className="text-3xl font-bold text-gray-900">{value}</div>
    </div>
  );
};

export const SpeedCoverageBlock = ({ data, loading }: SpeedCoverageBlockProps) => {
  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Скорость и покрытие</h2>
      <div className="grid grid-cols-3 gap-4">
        <MetricCard
          title="Среднее время ответа ИИ"
          value={formatTime(data?.avg_ai_response_time_ms ?? null)}
          tooltip="Среднее время между сообщением клиента и ответом ИИ"
          loading={loading}
        />
        <MetricCard
          title="Среднее время ответа оператора"
          value={formatTime(data?.avg_operator_response_time_ms ?? null)}
          tooltip="Среднее время между сообщением клиента и ответом оператора"
          loading={loading}
        />
        <MetricCard
          title="Процент чатов с передачей"
          value={
            data?.handoff.pct !== null
              ? `${data?.handoff.pct ?? 0}%`
              : 'N/A'
          }
          tooltip="Процент диалогов, где ИИ запросил помощь оператора"
          loading={loading}
        />
      </div>
    </div>
  );
};
