'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { StatsData } from '@/hooks/useStats';
import { Card } from '@/components/ui/card';

interface TrendsBlockProps {
  data: StatsData | null;
  loading: boolean;
}

export const TrendsBlock = ({ data, loading }: TrendsBlockProps) => {
  if (loading) {
    return (
      <div className="mb-8">
        <h2 className="mb-4 text-lg font-normal text-[color:var(--color-chalk)]">Тренды</h2>
        <div className="grid grid-cols-2 gap-4">
          <Card className="h-80 border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] p-6">
            <div className="h-full w-full animate-pulse rounded bg-[color:var(--color-obsidian)]" />
          </Card>
          <Card className="h-80 border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] p-6">
            <div className="h-full w-full animate-pulse rounded bg-[color:var(--color-obsidian)]" />
          </Card>
        </div>
      </div>
    );
  }

  const conversationsTrendData = data?.trends.conversations.map((item) => ({
    day: new Date(item.day).toLocaleDateString('ru-RU', {
      month: 'short',
      day: 'numeric',
    }),
    value: item.value,
  })) || [];

  const conversionTrendData = data?.trends.conversion.map((item) => ({
    day: new Date(item.day).toLocaleDateString('ru-RU', {
      month: 'short',
      day: 'numeric',
    }),
    value: item.value,
  })) || [];

  return (
    <div className="mb-8">
      <h2 className="mb-4 text-lg font-normal text-[color:var(--color-chalk)]">Тренды</h2>
      <div className="grid grid-cols-2 gap-4">
        <Card className="border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] p-6">
          <h3 className="mb-4 text-sm font-medium text-[color:var(--color-smoke)]">Количество диалогов</h3>
          {conversationsTrendData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={conversationsTrendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#3a3f46" />
                <XAxis dataKey="day" tick={{ fontSize: 12, fill: '#8f969f' }} stroke="#8f969f" />
                <YAxis tick={{ fontSize: 12, fill: '#8f969f' }} stroke="#8f969f" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#111317',
                    border: '1px solid #2e3338',
                    borderRadius: '0.5rem',
                    color: '#f5f5f5',
                  }}
                  formatter={(value: number) => [value, 'Диалогов']}
                  labelStyle={{ color: '#f5f5f5' }}
                />
                <Line type="monotone" dataKey="value" stroke="#7ce0a6" dot={{ fill: '#7ce0a6', r: 4 }} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-80 items-center justify-center text-[color:var(--color-smoke)]">За этот период данных нет</div>
          )}
        </Card>

        <Card className="border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] p-6">
          <h3 className="mb-4 text-sm font-medium text-[color:var(--color-smoke)]">Конверсия в основную цель</h3>
          {conversionTrendData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={conversionTrendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#3a3f46" />
                <XAxis dataKey="day" tick={{ fontSize: 12, fill: '#8f969f' }} stroke="#8f969f" />
                <YAxis tick={{ fontSize: 12, fill: '#8f969f' }} stroke="#8f969f" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#111317',
                    border: '1px solid #2e3338',
                    borderRadius: '0.5rem',
                    color: '#f5f5f5',
                  }}
                  formatter={(value: number) => [value, 'Конверсии']}
                  labelStyle={{ color: '#f5f5f5' }}
                />
                <Line type="monotone" dataKey="value" stroke="#8db8ff" dot={{ fill: '#8db8ff', r: 4 }} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-80 items-center justify-center text-[color:var(--color-smoke)]">За этот период данных нет</div>
          )}
        </Card>
      </div>
    </div>
  );
};
