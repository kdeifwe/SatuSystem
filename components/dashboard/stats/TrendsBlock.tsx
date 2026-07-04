'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { StatsData } from '@/hooks/useStats';

interface TrendsBlockProps {
  data: StatsData | null;
  loading: boolean;
}

export const TrendsBlock = ({ data, loading }: TrendsBlockProps) => {
  if (loading) {
    return (
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Тренды</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white rounded-lg border border-gray-200 p-6 h-80">
            <div className="w-full h-full bg-gray-200 rounded animate-pulse"></div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-6 h-80">
            <div className="w-full h-full bg-gray-200 rounded animate-pulse"></div>
          </div>
        </div>
      </div>
    );
  }

  const conversationsTrendData = data?.trends.conversations.map(item => ({
    day: new Date(item.day).toLocaleDateString('ru-RU', {
      month: 'short',
      day: 'numeric',
    }),
    value: item.value,
  })) || [];

  const conversionTrendData = data?.trends.conversion.map(item => ({
    day: new Date(item.day).toLocaleDateString('ru-RU', {
      month: 'short',
      day: 'numeric',
    }),
    value: item.value,
  })) || [];

  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Тренды</h2>
      <div className="grid grid-cols-2 gap-4">
        {/* Conversations trend */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="text-sm font-medium text-gray-700 mb-4">
            Количество диалогов
          </h3>
          {conversationsTrendData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={conversationsTrendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 12 }}
                  stroke="#9ca3af"
                />
                <YAxis tick={{ fontSize: 12 }} stroke="#9ca3af" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    border: '1px solid #e5e7eb',
                    borderRadius: '0.5rem',
                  }}
                  formatter={(value: number) => [value, 'Диалогов']}
                  labelStyle={{ color: '#1f2937' }}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#3b82f6"
                  dot={{ fill: '#3b82f6', r: 4 }}
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-80 flex items-center justify-center text-gray-500">
              За этот период данных нет
            </div>
          )}
        </div>

        {/* Conversion trend */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="text-sm font-medium text-gray-700 mb-4">
            Конверсия в основную цель
          </h3>
          {conversionTrendData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={conversionTrendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 12 }}
                  stroke="#9ca3af"
                />
                <YAxis tick={{ fontSize: 12 }} stroke="#9ca3af" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    border: '1px solid #e5e7eb',
                    borderRadius: '0.5rem',
                  }}
                  formatter={(value: number) => [value, 'Конверсии']}
                  labelStyle={{ color: '#1f2937' }}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#10b981"
                  dot={{ fill: '#10b981', r: 4 }}
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-80 flex items-center justify-center text-gray-500">
              За этот период данных нет
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
