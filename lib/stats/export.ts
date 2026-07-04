export interface StatsExportFilterValues {
  period?: string;
  from?: string | Date | null;
  to?: string | Date | null;
  channel?: string | null;
  campaign?: string | null;
  outcome?: string | null;
}

export interface StatsExportSheet {
  name: string;
  rows: Array<Array<string | number | null>>;
}

export interface StatsExportData {
  sheets: StatsExportSheet[];
}

function formatDate(value?: string | Date | null) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatDuration(value?: number | null) {
  if (value === null || value === undefined || value <= 0) return '—';
  const seconds = Math.round(value / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}м ${remainder}с` : `${remainder}с`;
}

function formatPct(value?: number | null) {
  if (value === null || value === undefined) return '—';
  return `${value}%`;
}

function formatMetricValue(value?: number | null, fallback = '—') {
  if (value === null || value === undefined) return fallback;
  return value;
}

export function buildStatsExportData(
  statsData: Record<string, any>,
  filters: StatsExportFilterValues = {}
): StatsExportData {
  const summaryRows: Array<Array<string | number | null>> = [
    ['Фильтр', 'Значение'],
    ['Период', filters.period ?? 'month'],
    ['От', formatDate(filters.from)],
    ['До', formatDate(filters.to)],
    ['Канал', filters.channel || 'Все'],
    ['Кампания', filters.campaign || 'Все'],
    ['Исход', filters.outcome || 'Все'],
    [],
    ['Блок', 'Значение'],
    ['Конверсия', `${formatPct(statsData?.conversion?.pct)} (${formatMetricValue(statsData?.conversion?.count)} / ${formatMetricValue(statsData?.conversion?.x)})`],
    ['Неопределённый закрыт', `${formatPct(statsData?.undefined_close?.pct)} (${formatMetricValue(statsData?.undefined_close?.count)})`],
    ['Без ответа', `${formatPct(statsData?.no_response?.pct)} (${formatMetricValue(statsData?.no_response?.count)})`],
    ['Диалоги', formatMetricValue(statsData?.dialog_count)],
    ['Сообщения ИИ', formatMetricValue(statsData?.ai_messages?.count)],
    ['Сообщения ИИ (основные)', formatMetricValue(statsData?.ai_messages?.main)],
    ['Сообщения ИИ (по сценариям/рассылкам)', formatMetricValue(statsData?.ai_messages?.followup)],
    ['Средние сообщения клиента/диалог', formatMetricValue(statsData?.avg_client_messages_per_conversation)],
    ['Средние сообщения ИИ/диалог', formatMetricValue(statsData?.avg_ai_messages_per_conversation)],
    ['Среднее время ответа ИИ', formatDuration(statsData?.avg_ai_response_time_ms)],
    ['Среднее время ответа оператора', formatDuration(statsData?.avg_operator_response_time_ms)],
    ['Передача в оператора', `${formatPct(statsData?.handoff?.pct)} (${formatMetricValue(statsData?.handoff?.count)})`],
  ];

  const trendRows: Array<Array<string | number | null>> = [
    ['Дата', 'Диалогов', 'Конверсия (%)'],
    ...((statsData?.trends?.conversations || []).map((item: any, index: number) => [
      item?.day ?? '',
      item?.value ?? 0,
      statsData?.trends?.conversion?.[index]?.value ?? 0,
    ]) as Array<Array<string | number | null>>),
  ];

  const sourcesRows: Array<Array<string | number | null>> = [
    ['Источник', 'Диалогов', 'Конверсия', '% конверсии'],
    ...((statsData?.sources || []).map((item: any) => [
      item?.source ?? '—',
      item?.count ?? 0,
      item?.conversion_count ?? 0,
      item?.conversion_pct ?? 0,
    ]) as Array<Array<string | number | null>>),
  ];

  const teamRows: Array<Array<string | number | null>> = [
    ['Менеджер', 'Назначено лидов', 'Обработано чатов', 'Сообщений', 'Среднее время ответа'],
    ...((statsData?.team || []).map((item: any) => [
      item?.operator_name || item?.assigned_to || 'Неизвестно',
      item?.assigned_leads ?? 0,
      item?.handled_chats ?? 0,
      item?.operator_messages ?? 0,
      formatDuration(item?.avg_response_ms),
    ]) as Array<Array<string | number | null>>),
  ];

  return {
    sheets: [
      { name: 'Сводка', rows: summaryRows },
      { name: 'Тренды по дням', rows: trendRows },
      { name: 'Источники лидов', rows: sourcesRows },
      { name: 'Команда', rows: teamRows },
    ],
  };
}
