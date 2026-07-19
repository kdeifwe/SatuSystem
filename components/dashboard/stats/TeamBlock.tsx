'use client';

import { useState } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { StatsData } from '@/hooks/useStats';
import { Card } from '@/components/ui/card';

interface TeamBlockProps {
  data: StatsData | null;
  loading: boolean;
}

type SortField = 'operator_name' | 'assigned_leads' | 'handled_chats' | 'operator_messages' | 'avg_response_ms';

const formatTime = (ms: number | null): string => {
  if (ms === null || ms === undefined || ms === 0) return 'N/A';

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
        <h2 className="mb-4 text-lg font-normal text-[color:var(--color-chalk)]">Команда</h2>
        <Card className="border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] p-6">
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded bg-[color:var(--color-obsidian)]" />
            ))}
          </div>
        </Card>
      </div>
    );
  }

  const team = data?.team || [];

  const sortedTeam = [...team].sort((a, b) => {
    let aVal: any = a[sortField];
    let bVal: any = b[sortField];

    if (aVal === null || aVal === undefined) aVal = sortField === 'operator_name' ? '' : 0;
    if (bVal === null || bVal === undefined) bVal = sortField === 'operator_name' ? '' : 0;

    if (typeof aVal === 'string') {
      return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }

    return sortAsc ? aVal - bVal : bVal - aVal;
  });

  const SortHeader = ({ label, field }: { label: string; field: SortField }) => (
    <button onClick={() => toggleSort(field)} className="flex items-center gap-1 transition-colors hover:text-[color:var(--color-chalk)]">
      {label}
      {sortField === field && (sortAsc ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
    </button>
  );

  return (
    <div className="mb-8">
      <h2 className="mb-4 text-lg font-normal text-[color:var(--color-chalk)]">Команда</h2>
      <Card className="overflow-hidden border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] p-0">
        {sortedTeam.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-[color:var(--color-smoke)]">Нет данных по команде</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="border-b border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)]">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-[color:var(--color-smoke)]">
                  <SortHeader label="Менеджер" field="operator_name" />
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-[color:var(--color-smoke)]">
                  <SortHeader label="Назначено" field="assigned_leads" />
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-[color:var(--color-smoke)]">
                  <SortHeader label="Обработано чатов" field="handled_chats" />
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-[color:var(--color-smoke)]">
                  <SortHeader label="Сообщений" field="operator_messages" />
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-[color:var(--color-smoke)]">
                  <SortHeader label="Среднее время ответа" field="avg_response_ms" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--color-graphite)]">
              {sortedTeam.map((member) => (
                <tr key={member.assigned_to || 'unknown'} className="hover:bg-[color:var(--color-obsidian)]">
                  <td className="px-6 py-4 text-sm text-[color:var(--color-chalk)]">{member.operator_name || 'Неизвестный'}</td>
                  <td className="px-6 py-4 text-sm text-[color:var(--color-smoke)]">{member.assigned_leads}</td>
                  <td className="px-6 py-4 text-sm text-[color:var(--color-smoke)]">{member.handled_chats}</td>
                  <td className="px-6 py-4 text-sm text-[color:var(--color-smoke)]">{member.operator_messages}</td>
                  <td className="px-6 py-4 text-sm text-[color:var(--color-smoke)]">{formatTime(member.avg_response_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
};
