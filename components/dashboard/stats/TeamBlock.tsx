'use client';

import { useState } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { StatsData } from '@/hooks/useStats';

interface TeamBlockProps {
  data: StatsData | null;
  loading: boolean;
}

type SortField =
  | 'operator_name'
  | 'assigned_leads'
  | 'handled_chats'
  | 'operator_messages'
  | 'avg_response_ms';

const formatTime = (ms: number | null): string => {
  if (ms === null || ms === undefined) return 'N/A';
  if (ms === 0) return 'N/A';

  const seconds = ms / 1000;
  if (seconds < 60) return `${Math.round(seconds)}с`;

  const minutes = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${minutes}м ${secs}с`;
};

export const TeamBlock = ({ data, loading }: TeamBlockProps) => {
  const [sortField, setSortField] = useState<SortField>('assigned_leads');
  const [sortAsc, setSortAsc] = useState(false);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  if (loading) {
    return (
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Команда</h2>
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-12 bg-gray-200 rounded animate-pulse"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const team = data?.team || [];

  const sortedTeam = [...team].sort((a, b) => {
    let aVal: any = a[sortField];
    let bVal: any = b[sortField];

    // Handle null values
    if (aVal === null || aVal === undefined) aVal = sortField === 'operator_name' ? '' : 0;
    if (bVal === null || bVal === undefined) bVal = sortField === 'operator_name' ? '' : 0;

    if (typeof aVal === 'string') {
      return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }

    return sortAsc ? aVal - bVal : bVal - aVal;
  });

  const SortHeader = ({
    label,
    field,
  }: {
    label: string;
    field: SortField;
  }) => (
    <button
      onClick={() => toggleSort(field)}
      className="flex items-center gap-1 hover:text-blue-600 transition-colors"
    >
      {label}
      {sortField === field && (
        sortAsc ? (
          <ChevronUp size={14} />
        ) : (
          <ChevronDown size={14} />
        )
      )}
    </button>
  );

  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Команда</h2>
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {sortedTeam.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-gray-500">Нет данных по команде</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <SortHeader label="Менеджер" field="operator_name" />
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <SortHeader label="Назначено" field="assigned_leads" />
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <SortHeader label="Обработано чатов" field="handled_chats" />
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <SortHeader label="Сообщений" field="operator_messages" />
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <SortHeader label="Среднее время ответа" field="avg_response_ms" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {sortedTeam.map(member => (
                <tr
                  key={member.assigned_to || 'unknown'}
                  className="hover:bg-gray-50"
                >
                  <td className="px-6 py-4 text-sm text-gray-900">
                    {member.operator_name || 'Неизвестный'}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {member.assigned_leads}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {member.handled_chats}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {member.operator_messages}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {formatTime(member.avg_response_ms)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
