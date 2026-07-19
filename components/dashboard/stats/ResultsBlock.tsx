'use client';

import { useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { StatsData } from '@/hooks/useStats';
import { Card } from '@/components/ui/card';

interface ResultsBlockProps {
  data: StatsData | null;
  loading: boolean;
}

const Tooltip = ({ text, children }: { text: string; children: ReactNode }) => {
  const [show, setShow] = useState(false);
  return (
    <div className="relative inline-block">
      <div onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)} className="cursor-help">
        {children}
      </div>
      {show && (
        <div className="absolute bottom-full left-1/2 z-20 mb-2 -translate-x-1/2 whitespace-nowrap rounded bg-[color:var(--color-obsidian)] px-2 py-1 text-xs text-[color:var(--color-chalk)]">
          {text}
          <div className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-[color:var(--color-obsidian)]" />
        </div>
      )}
    </div>
  );
};

const ResultCard = ({
  title,
  percentage,
  count,
  tooltip,
  loading,
}: {
  title: string;
  percentage: number | null;
  count: string;
  tooltip: string;
  loading: boolean;
}) => {
  if (loading) {
    return (
      <Card className="border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="h-5 w-32 animate-pulse rounded bg-[color:var(--color-obsidian)]" />
          <Info size={16} className="text-[color:var(--color-smoke)]" />
        </div>
        <div className="mb-2 h-8 w-16 animate-pulse rounded bg-[color:var(--color-obsidian)]" />
        <div className="h-4 w-20 animate-pulse rounded bg-[color:var(--color-obsidian)]" />
      </Card>
    );
  }

  return (
    <Card className="border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-medium text-[color:var(--color-smoke)]">{title}</h3>
        <Tooltip text={tooltip}>
          <Info size={16} className="text-[color:var(--color-smoke)] hover:text-[color:var(--color-chalk)]" />
        </Tooltip>
      </div>
      <div className="mb-1 text-3xl font-normal tracking-[-0.02em] text-[color:var(--color-chalk)]">
        {percentage !== null ? `${percentage}%` : 'N/A'}
      </div>
      <div className="text-sm text-[color:var(--color-smoke)]">{count}</div>
    </Card>
  );
};

export const ResultsBlock = ({ data, loading }: ResultsBlockProps) => {
  return (
    <div className="mb-8">
      <h2 className="mb-4 text-lg font-normal text-[color:var(--color-chalk)]">Результаты</h2>
      <div className="grid grid-cols-3 gap-4">
        <ResultCard
          title="Конверсия в основную цель"
          percentage={data?.conversion.pct ?? null}
          count={`${data?.conversion.x ?? 0} / ${data?.conversion.y ?? 0} чатов`}
          tooltip="Процент диалогов, в которых достигнута основная цель продажи"
          loading={loading}
        />
        <ResultCard
          title="Неопределенные закрытые лиды"
          percentage={data?.undefined_close.pct ?? null}
          count={`${data?.undefined_close.count ?? 0} чатов`}
          tooltip="Диалоги, закрытые без четкого результата (отказ не был явно выражен)"
          loading={loading}
        />
        <ResultCard
          title="Чаты без ответа клиента"
          percentage={data?.no_response.pct ?? null}
          count={`${data?.no_response.count ?? 0} чатов`}
          tooltip="Диалоги, где клиент не ответил на сообщение ИИ в течение установленного времени ожидания"
          loading={loading}
        />
      </div>
    </div>
  );
};
