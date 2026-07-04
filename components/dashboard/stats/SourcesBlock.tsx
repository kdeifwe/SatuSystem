'use client';

import { StatsData } from '@/hooks/useStats';

interface SourcesBlockProps {
  data: StatsData | null;
  loading: boolean;
}

export const SourcesBlock = ({ data, loading }: SourcesBlockProps) => {
  if (loading) {
    return (
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Источники лидов</h2>
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

  const sources = data?.sources || [];

  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Источники лидов</h2>
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {sources.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-gray-500">За этот период лидов пока нет</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Источник
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Диалогов
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Конверсия
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  % конверсии
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {sources.map(source => (
                <tr key={source.source} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm text-gray-900">
                    {source.source}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {source.count}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {source.conversion_count}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {source.conversion_pct !== null
                      ? `${source.conversion_pct}%`
                      : 'N/A'}
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
