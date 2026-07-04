'use client';

import { Info } from 'lucide-react';
import { StatsData } from '@/hooks/useStats';

interface ResultsBlockProps {
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

import * as React from 'react';

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
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="h-5 w-32 bg-gray-200 rounded animate-pulse"></div>
          <Info size={16} className="text-gray-400" />
        </div>
        <div className="h-8 w-16 bg-gray-200 rounded animate-pulse mb-2"></div>
        <div className="h-4 w-20 bg-gray-200 rounded animate-pulse"></div>
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
      <div className="text-3xl font-bold text-gray-900 mb-1">
        {percentage !== null ? `${percentage}%` : 'N/A'}
      </div>
      <div className="text-sm text-gray-500">{count}</div>
    </div>
  );
};

export const ResultsBlock = ({ data, loading }: ResultsBlockProps) => {
  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Результаты</h2>
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
