'use client';

import { Lightbulb } from 'lucide-react';

export const InsightsBlock = () => {
  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">
        Инсайты по лидам
      </h2>
      <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
        <Lightbulb size={48} className="mx-auto mb-4 text-gray-400" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">
          Собираем данные
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          Мета-агент анализирует закрытые диалоги и выявляет общие причины успехов и отказов
        </p>
        <div className="inline-block bg-blue-50 text-blue-700 text-xs px-3 py-1 rounded-full">
          Будущая фаза разработки
        </div>
        {/* TODO: Implement AI-driven lead insights clustering in phase 2
         * This will use LLM (Gemini) to analyze closed conversations in batches
         * and store results in a new lead_insights table for statistical aggregation
         * See /docs/SPEC.md section 6.9 for details
         */}
      </div>
    </div>
  );
};
