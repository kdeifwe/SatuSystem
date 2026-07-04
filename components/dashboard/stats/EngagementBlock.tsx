'use client';

import { TrendingUp, TrendingDown } from 'lucide-react';
import { StatsData } from '@/hooks/useStats';

interface EngagementBlockProps {
  data: StatsData | null;
  loading: boolean;
}

const MetricCard = ({
  title,
  value,
  subtitle,
  submetrics,
  change,
  loading,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  submetrics?: { label: string; value: string | number }[];
  change?: { value: number; direction: 'up' | 'down' };
  loading: boolean;
}) => {
  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="h-5 w-24 bg-gray-200 rounded animate-pulse mb-4"></div>
        <div className="h-8 w-16 bg-gray-200 rounded animate-pulse mb-2"></div>
        <div className="h-4 w-20 bg-gray-200 rounded animate-pulse"></div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h3 className="text-sm font-medium text-gray-700 mb-4">{title}</h3>
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-3xl font-bold text-gray-900">{value}</div>
        {change && (
          <div
            className={`flex items-center gap-1 text-sm font-medium ${
              change.direction === 'up' ? 'text-green-600' : 'text-red-600'
            }`}
          >
            {change.direction === 'up' ? (
              <TrendingUp size={16} />
            ) : (
              <TrendingDown size={16} />
            )}
            {Math.abs(change.value)}%
          </div>
        )}
      </div>
      {subtitle && <p className="text-sm text-gray-500 mb-3">{subtitle}</p>}
      {submetrics && (
        <div className="space-y-2 mt-4 pt-4 border-t border-gray-200">
          {submetrics.map(metric => (
            <div key={metric.label} className="flex justify-between items-center text-sm">
              <span className="text-gray-600">{metric.label}:</span>
              <span className="font-medium text-gray-900">{metric.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const EngagementBlock = ({ data, loading }: EngagementBlockProps) => {
  const dialogChange = data?.dialog_count_change_pct;
  const dialogChangeDirection =
    (dialogChange ?? 0) >= 0 ? 'up' : 'down';
  const aiMessagesChange = data?.ai_messages.change_pct;
  const aiMessagesChangeDirection =
    (aiMessagesChange ?? 0) >= 0 ? 'up' : 'down';

  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Вовлечённость</h2>
      <div className="grid grid-cols-3 gap-4">
        <MetricCard
          title="Количество диалогов"
          value={data?.dialog_count ?? 0}
          change={
            dialogChange !== null && dialogChange !== undefined
              ? {
                  value: Math.abs(dialogChange),
                  direction: dialogChangeDirection as 'up' | 'down',
                }
              : undefined
          }
          loading={loading}
        />
        <MetricCard
          title="Сообщения от ИИ"
          value={data?.ai_messages.count ?? 0}
          change={
            aiMessagesChange !== null && aiMessagesChange !== undefined
              ? {
                  value: Math.abs(aiMessagesChange),
                  direction: aiMessagesChangeDirection as 'up' | 'down',
                }
              : undefined
          }
          submetrics={[
            {
              label: 'Основные сообщения',
              value: data?.ai_messages.main ?? 0,
            },
            {
              label: 'Из них по сценариям/рассылкам',
              value: data?.ai_messages.followup ?? 0,
            },
          ]}
          loading={loading}
        />
        <MetricCard
          title="Среднее сообщений за диалог"
          value={
            data?.avg_ai_messages_per_conversation !== null
              ? `${data?.avg_ai_messages_per_conversation ?? 0}`
              : 'N/A'
          }
          loading={loading}
        />
      </div>
      <div className="grid grid-cols-2 gap-4 mt-4">
        <MetricCard
          title="Среднее сообщений от клиента"
          value={
            data?.avg_client_messages_per_conversation !== null
              ? `${data?.avg_client_messages_per_conversation ?? 0}`
              : 'N/A'
          }
          loading={loading}
        />
        <MetricCard
          title="Среднее сообщений от ИИ на диалог"
          value={
            data?.avg_ai_messages_per_conversation !== null
              ? `${data?.avg_ai_messages_per_conversation ?? 0}`
              : 'N/A'
          }
          loading={loading}
        />
      </div>
    </div>
  );
};
