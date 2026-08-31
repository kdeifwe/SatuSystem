'use client';

import { useEffect, useMemo, useState } from 'react';
import { createSignalAction, createSmartCampaignAction, generateCampaignMessagesAction, approveCampaignRecipientsAction, sendCampaignRecipientsAction, loadCampaignReviewDataAction, loadCampaignDashboardDataAction, updateCampaignRecipientAction, generateSmartBroadcastPreviewAction } from './actions';
import { filterSignalsForTable, getActiveSignalsCount, getAudienceLeadCount } from './utils';

interface SmartSignalItem {
  id: string;
  lead_id: string;
  lead_name?: string | null;
  lead_status?: string | null;
  signal_type: string;
  description: string;
  raw_quote?: string | null;
  status: string;
  created_at: string;
}

interface SmartCampaignItem {
  id: string;
  name: string;
  status: string;
  requires_approval: boolean;
  created_at: string;
}

interface LeadOptionItem {
  id: string;
  name: string;
  status: string;
  external_id?: string | null;
}

interface SmartBroadcastsClientPageProps {
  agentId: string;
  initialSignals: SmartSignalItem[];
  initialCampaigns: SmartCampaignItem[];
  initialCanToggleApproval: boolean;
  initialLeads: LeadOptionItem[];
}

interface ReviewRecipientItem {
  id: string;
  leadId: string;
  leadName: string;
  generatedMessage: string;
  status: string;
  skipReason?: string | null;
  signalType?: string | null;
  signalDescription?: string | null;
  rawQuote?: string | null;
}

interface CampaignDashboardRecipientItem {
  id: string;
  leadId: string;
  leadName: string;
  status: string;
  generatedMessage: string;
  skipReason?: string | null;
}

interface CampaignDashboardData {
  campaign: { id: string; name: string; status: string };
  stats: { sent: number; replied: number; errors: number; skipped: number };
  timeline: Array<{ label: string; date: string; sent: number; replied: number; failed: number; skipped: number }>;
  recipients: CampaignDashboardRecipientItem[];
}

const SIGNAL_TYPE_LABELS: Record<string, string> = {
  awaiting_funds: 'Ждёт деньги',
  awaiting_approval: 'Нужно согласование',
  awaiting_decision: 'Считает/сравнивает',
  competitor_comparison: 'Сравнивает с конкурентом',
  busy_later: 'Позже',
  price_objection: 'Цена',
  custom: 'Другое',
};

function formatLeadLabel(lead: LeadOptionItem) {
  const name = lead.name || 'Без имени';
  const statusLabel = lead.status ? ` (${lead.status})` : '';
  const externalIdLabel = lead.external_id ? ` — ${lead.external_id}` : '';
  return `${name}${statusLabel}${externalIdLabel}`;
}

export default function SmartBroadcastsClientPage({ agentId, initialSignals, initialCampaigns, initialCanToggleApproval, initialLeads }: SmartBroadcastsClientPageProps) {
  const [step, setStep] = useState(1);
  const [signals, setSignals] = useState(initialSignals);
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [form, setForm] = useState({
    signalTypes: ['awaiting_funds', 'awaiting_approval'],
    minSignalAgeHours: 24,
    goalInstruction: 'Спроси, пришла ли зарплата, и мягко предложи оформить заказ на тех же условиях',
    requiresApproval: true,
    pacing: 5,
    respectWorkHours: true,
    maxMessageLength: 240,
  });
  const [preview, setPreview] = useState<Array<{ leadId: string; leadName: string; message: string; rawQuote?: string | null }>>([]);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [quickSignal, setQuickSignal] = useState({ leadId: '', signalType: 'awaiting_funds', description: 'Ждёт зарплату', rawQuote: 'Куплю после зарплаты' });
  const [leadSearch, setLeadSearch] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [reviewRecipients, setReviewRecipients] = useState<ReviewRecipientItem[]>([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [canToggleApproval, setCanToggleApproval] = useState(initialCanToggleApproval);
  const [selectedSignalIds, setSelectedSignalIds] = useState<string[]>([]);
  const [signalFilters, setSignalFilters] = useState({ signalType: 'all', dateRange: 'all', leadStatus: 'all' });
  const [campaignDashboard, setCampaignDashboard] = useState<CampaignDashboardData | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);

  const audienceLeadCount = getAudienceLeadCount(signals, form.signalTypes, form.minSignalAgeHours);
  const approvedReviewCount = reviewRecipients.filter((recipient) => recipient.status === 'approved').length;
  const filteredSignals = filterSignalsForTable(signals, signalFilters);
  const activeSignalsCount = signals.filter((signal) => signal.status === 'active').length;
  const availableSignalTypes = Array.from(new Set(signals.map((signal) => signal.signal_type))) as string[];
  const availableLeadStatuses = Array.from(new Set(signals.map((signal) => signal.lead_status).filter((value): value is string => Boolean(value)))) as string[];
  const visibleLeads = useMemo(() => {
    const query = leadSearch.trim().toLowerCase();
    if (!query) {
      return initialLeads;
    }

    return initialLeads.filter((lead) => [lead.name, lead.status, lead.external_id].filter(Boolean).some((value) => String(value).toLowerCase().includes(query)));
  }, [initialLeads, leadSearch]);

  async function refreshReviewRecipients(campaignIdValue: string) {
    if (!campaignIdValue) return;
    setReviewLoading(true);
    try {
      const result = await loadCampaignReviewDataAction(agentId, campaignIdValue);
      if (result.success) {
        setReviewRecipients(result.recipients ?? []);
      }
    } finally {
      setReviewLoading(false);
    }
  }

  async function refreshCampaignDashboard(campaignIdValue: string) {
    if (!campaignIdValue) {
      setCampaignDashboard(null);
      return;
    }
    setDashboardLoading(true);
    try {
      const result = await loadCampaignDashboardDataAction(agentId, campaignIdValue);
      if (result.success) {
        setCampaignDashboard(result);
      }
    } finally {
      setDashboardLoading(false);
    }
  }

  useEffect(() => {
    if (campaignId) {
      void refreshReviewRecipients(campaignId);
      void refreshCampaignDashboard(campaignId);
    }
  }, [campaignId, agentId]);

  useEffect(() => {
    if (!canToggleApproval) {
      setForm((current) => ({ ...current, requiresApproval: false }));
    }
  }, [canToggleApproval]);

  function handleNextStep() {
    if (step === 1 && form.signalTypes.length === 0) {
      setStatus('Выберите хотя бы один тип сигнала для аудитории.');
      return;
    }

    if (step === 2 && !form.goalInstruction.trim()) {
      setStatus('Добавьте цель кампании, чтобы перейти дальше.');
      return;
    }

    setStatus('');
    setStep((current) => Math.min(4, current + 1));
  }

  async function handleCreateSignal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!quickSignal.leadId.trim()) {
      setStatus('Выберите лида из списка.');
      return;
    }

    setLoading(true);
    setStatus('Создаю сигнал...');
    const result = await createSignalAction(agentId, {
      leadId: quickSignal.leadId,
      signalType: quickSignal.signalType,
      description: quickSignal.description,
      rawQuote: quickSignal.rawQuote,
    });
    setLoading(false);
    if (result.success) {
      setStatus('Сигнал сохранён.');
      setQuickSignal((current) => ({ ...current, leadId: '', description: '', rawQuote: '' }));
      setLeadSearch('');
    }
  }

  async function handleRefreshPreview() {
    setLoading(true);
    setStatus('Генерирую новый предпросмотр...');
    const result = await generateSmartBroadcastPreviewAction(agentId, {
      signalTypes: form.signalTypes,
      minSignalAgeHours: form.minSignalAgeHours,
      goalInstruction: form.goalInstruction,
      maxMessageLength: form.maxMessageLength,
    });
    setLoading(false);
    if (result.success) {
      setPreview(result.preview);
      setStatus('Предпросмотр обновлён.');
    }
  }

  function toggleSelectedSignal(signalId: string) {
    setSelectedSignalIds((current) => current.includes(signalId) ? current.filter((item) => item !== signalId) : [...current, signalId]);
  }

  function handleUseSelectedSignals() {
    const selectedSignals = filteredSignals.filter((signal) => selectedSignalIds.includes(signal.id));
    const selectedSignalTypes = Array.from(new Set(selectedSignals.map((signal) => signal.signal_type)));
    if (selectedSignalTypes.length === 0) {
      setStatus('Выберите хотя бы один сигнал для добавления в аудиторию.');
      return;
    }
    setForm((current) => ({ ...current, signalTypes: selectedSignalTypes }));
    setSelectedSignalIds([]);
    setStatus('Выбранные типы сигналов добавлены в аудиторию.');
  }

  async function handleCreateCampaign() {
    setLoading(true);
    setStatus('Создаю кампанию и генерирую превью...');
    const result = await createSmartCampaignAction(agentId, {
      signalTypes: form.signalTypes,
      minSignalAgeHours: form.minSignalAgeHours,
      goalInstruction: form.goalInstruction,
      requiresApproval: form.requiresApproval,
      pacing: form.pacing,
      respectWorkHours: form.respectWorkHours,
      maxMessageLength: form.maxMessageLength,
    });
    setLoading(false);
    if (result.success) {
      setCampaignId(result.campaignId);
      setPreview(result.preview);
      setReviewRecipients([]);
      setStatus(`Кампания создана, получателей: ${result.recipientCount}.`);
      setStep(3);
      setCanToggleApproval(initialCanToggleApproval);
      void refreshReviewRecipients(result.campaignId);
    }
  }

  async function handleGenerateMessages() {
    if (!campaignId) return;
    setLoading(true);
    setStatus('Генерирую сообщения для всех...');
    const result = await generateCampaignMessagesAction(agentId, campaignId);
    setLoading(false);
    if (result.success) {
      setStatus(`Сгенерировано ${result.count} сообщений.`);
      void refreshReviewRecipients(campaignId);
    }
  }

  async function handleApprove() {
    if (!campaignId) return;
    setLoading(true);
    setStatus('Одобряем сообщения...');
    const result = await approveCampaignRecipientsAction(agentId, campaignId);
    setLoading(false);
    if (result.success) {
      setReviewRecipients((current) => current.map((recipient) => ({ ...recipient, status: 'approved' })));
      setStatus('Сообщения переданы в стадию отправки.');
    }
  }

  async function handleApproveRecipient(recipientId: string) {
    const recipient = reviewRecipients.find((item) => item.id === recipientId);
    if (!recipient || !campaignId) return;
    const nextStatus = recipient.status === 'approved' ? 'generated' : 'approved';
    setReviewRecipients((current) => current.map((item) => item.id === recipientId ? { ...item, status: nextStatus } : item));
    await updateCampaignRecipientAction(agentId, { campaignId, recipientId, action: nextStatus === 'approved' ? 'approve' : 'update' });
  }

  async function handleSkipRecipient(recipientId: string) {
    if (!campaignId) return;
    setReviewRecipients((current) => current.map((item) => item.id === recipientId ? { ...item, status: 'skipped' } : item));
    await updateCampaignRecipientAction(agentId, { campaignId, recipientId, action: 'skip' });
  }

  async function handleSaveRecipientMessage(recipientId: string, generatedMessage: string) {
    if (!campaignId) return;
    setReviewRecipients((current) => current.map((item) => item.id === recipientId ? { ...item, generatedMessage, status: item.status === 'approved' ? 'approved' : 'generated' } : item));
    await updateCampaignRecipientAction(agentId, { campaignId, recipientId, generatedMessage, action: 'update' });
  }

  async function handleSend() {
    if (!campaignId) return;
    setLoading(true);
    setStatus('Отправляем через адаптер канала...');
    const result = await sendCampaignRecipientsAction(agentId, campaignId);
    setLoading(false);
    if (result.success) {
      setStatus(`Отправлено ${result.count} сообщений (адаптер-обёртка).`);
    }
  }

  function handleSelectCampaign(selectedCampaignId: string) {
    setCampaignId(selectedCampaignId);
    setStep(4);
    void refreshCampaignDashboard(selectedCampaignId);
  }

  return (
    <div className="min-h-full bg-[color:var(--color-obsidian)] p-6 text-[color:var(--color-chalk)]">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Умные рассылки</h1>
          <p className="mt-1 text-sm text-[color:var(--color-smoke)]">Отдельный модуль поверх обычных рассылок: сигналы, генерация сообщений по одному лидy и предпросмотр перед отправкой.</p>
        </div>
        <div className="rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] px-4 py-3 text-sm">
          <div className="text-[color:var(--color-smoke)]">Активных сигналов</div>
          <div className="text-xl font-semibold text-[color:var(--color-chalk)]">{getActiveSignalsCount(signals)}</div>
        </div>
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <section className="rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[color:var(--color-smoke)]">Быстрое добавление сигнала</h2>
          <form onSubmit={handleCreateSignal} className="space-y-3">
            {initialLeads.length === 0 ? (
              <div className="w-full rounded border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm text-[color:var(--color-smoke)]">Нет лидов</div>
            ) : (
              <>
                <input className="w-full rounded border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm" placeholder="Поиск по имени или external_id" value={leadSearch} onChange={(event) => setLeadSearch(event.target.value)} />
                <select className="w-full rounded border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm" value={quickSignal.leadId} onChange={(event) => setQuickSignal((current) => ({ ...current, leadId: event.target.value }))}>
                  <option value="">Выберите лида</option>
                  {visibleLeads.map((lead) => <option key={lead.id} value={lead.id}>{formatLeadLabel(lead)}</option>)}
                </select>
                {leadSearch.trim() && visibleLeads.length === 0 ? <div className="text-xs text-[color:var(--color-smoke)]">Лидов по запросу не найдено</div> : null}
              </>
            )}
            <select className="w-full rounded border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm" value={quickSignal.signalType} onChange={(event) => setQuickSignal((current) => ({ ...current, signalType: event.target.value }))}>
              {Object.entries(SIGNAL_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <input className="w-full rounded border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm" placeholder="Краткое описание" value={quickSignal.description} onChange={(event) => setQuickSignal((current) => ({ ...current, description: event.target.value }))} />
            <input className="w-full rounded border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm" placeholder="Точная цитата клиента" value={quickSignal.rawQuote} onChange={(event) => setQuickSignal((current) => ({ ...current, rawQuote: event.target.value }))} />
            <button type="submit" disabled={loading || initialLeads.length === 0} className="rounded bg-[color:var(--color-ash)] px-3 py-2 text-sm font-medium text-[color:var(--color-carbon)] disabled:cursor-not-allowed disabled:opacity-60">
              {loading ? 'Сохраняю...' : 'Сохранить сигнал'}
            </button>
          </form>
        </section>

        <section className="rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] p-4">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-[color:var(--color-smoke)]">Обнаруженные причины</h2>
              <p className="mt-1 text-sm text-[color:var(--color-smoke)]">Фильтруйте по типу сигнала, дате и статусу лида. Активных сигналов сейчас: {activeSignalsCount}.</p>
            </div>
            <div className="rounded border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm">
              <div className="text-[color:var(--color-smoke)]">Показано</div>
              <div className="font-semibold text-[color:var(--color-chalk)]">{filteredSignals.length} сигналов</div>
            </div>
          </div>
          <div className="mb-4 grid gap-3 md:grid-cols-3">
            <select value={signalFilters.signalType} onChange={(event) => setSignalFilters((current) => ({ ...current, signalType: event.target.value }))} className="rounded border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm">
              <option value="all">Все типы</option>
              {availableSignalTypes.map((value) => <option key={value} value={value}>{SIGNAL_TYPE_LABELS[value] ?? value}</option>)}
            </select>
            <select value={signalFilters.dateRange} onChange={(event) => setSignalFilters((current) => ({ ...current, dateRange: event.target.value }))} className="rounded border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm">
              <option value="all">За всё время</option>
              <option value="24h">Последние 24 часа</option>
              <option value="7d">За 7 дней</option>
              <option value="30d">За 30 дней</option>
            </select>
            <select value={signalFilters.leadStatus} onChange={(event) => setSignalFilters((current) => ({ ...current, leadStatus: event.target.value }))} className="rounded border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm">
              <option value="all">Все статусы лидов</option>
              {availableLeadStatuses.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <button type="button" onClick={handleUseSelectedSignals} className="rounded border border-[color:var(--color-graphite)] px-3 py-2 text-sm">Использовать выбранные в аудитории</button>
            <span className="text-sm text-[color:var(--color-smoke)]">{selectedSignalIds.length} выбрано</span>
          </div>
          <div className="overflow-hidden rounded border border-[color:var(--color-graphite)]">
            <table className="min-w-full divide-y divide-[color:var(--color-graphite)] text-sm">
              <thead className="bg-[color:var(--color-carbon)] text-left text-[color:var(--color-smoke)]">
                <tr>
                  <th className="px-3 py-2"> </th>
                  <th className="px-3 py-2">Лид</th>
                  <th className="px-3 py-2">Тип</th>
                  <th className="px-3 py-2">Краткое описание</th>
                  <th className="px-3 py-2">Дата</th>
                  <th className="px-3 py-2">Статус</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)]">
                {filteredSignals.map((signal) => (
                  <tr key={signal.id} className="align-top">
                    <td className="px-3 py-2"><input type="checkbox" checked={selectedSignalIds.includes(signal.id)} onChange={() => toggleSelectedSignal(signal.id)} /></td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{signal.lead_name || signal.lead_id}</div>
                      <div className="text-xs text-[color:var(--color-smoke)]">{signal.lead_status || '—'}</div>
                    </td>
                    <td className="px-3 py-2"><span className="rounded-full border border-[color:var(--color-graphite)] px-2 py-0.5 text-xs">{SIGNAL_TYPE_LABELS[signal.signal_type] ?? signal.signal_type}</span></td>
                    <td className="px-3 py-2">
                      <div>{signal.description}</div>
                      {signal.raw_quote ? <details className="mt-2 text-xs text-[color:var(--color-smoke)]"><summary className="cursor-pointer">Цитата</summary><div className="mt-1 rounded border border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] p-2">{signal.raw_quote}</div></details> : null}
                    </td>
                    <td className="px-3 py-2 text-xs text-[color:var(--color-smoke)]">{new Date(signal.created_at).toLocaleString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="px-3 py-2"><span className="rounded-full border border-[color:var(--color-graphite)] px-2 py-0.5 text-xs">{signal.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[color:var(--color-smoke)]">Мастер создания кампании</h2>
            <p className="mt-1 text-sm text-[color:var(--color-smoke)]">Четыре шага: аудитория, цель, предпросмотр, запуск.</p>
          </div>
          <div className="text-sm text-[color:var(--color-smoke)]">Шаг {step} / 4</div>
        </div>

        {status ? <div className="mb-4 rounded border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm">{status}</div> : null}

        {step === 1 ? (
          <div className="space-y-4">
            <div className="rounded border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm text-[color:var(--color-smoke)]">
              <span className="font-medium text-[color:var(--color-chalk)]">Аудитория:</span> {audienceLeadCount} лидов
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium">Типы сигналов</label>
              <div className="flex flex-wrap gap-2">
                {Object.entries(SIGNAL_TYPE_LABELS).map(([value, label]) => (
                  <button key={value} type="button" onClick={() => setForm((current) => ({ ...current, signalTypes: current.signalTypes.includes(value) ? current.signalTypes.filter((item) => item !== value) : [...current.signalTypes, value] }))} className={`rounded-full border px-3 py-1 text-sm ${form.signalTypes.includes(value) ? 'border-[color:var(--color-ash)] bg-[color:var(--color-ash)] text-[color:var(--color-carbon)]' : 'border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)]'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium">Минимальный возраст сигнала, часов</label>
              <input type="number" value={form.minSignalAgeHours} onChange={(event) => setForm((current) => ({ ...current, minSignalAgeHours: Number(event.target.value) }))} className="w-full max-w-sm rounded border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm" />
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium">Что должен сделать агент?</label>
              <textarea rows={4} value={form.goalInstruction} onChange={(event) => setForm((current) => ({ ...current, goalInstruction: event.target.value }))} className="w-full rounded border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.requiresApproval} disabled={!canToggleApproval} onChange={(event) => setForm((current) => ({ ...current, requiresApproval: event.target.checked }))} />
              Требовать подтверждение перед отправкой
            </label>
            {!canToggleApproval ? <div className="text-sm text-[color:var(--color-smoke)]">Станет доступно после первой кампании, отправленной с подтверждением.</div> : null}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-4">
            <div className="rounded border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm text-[color:var(--color-smoke)]">
              Для предпросмотра будет использовано до 3 реальных лидов из аудитории {audienceLeadCount} человек.
            </div>
            <div className="rounded border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="text-sm font-medium">Предпросмотр для реальных лидов</div>
                <button type="button" onClick={handleRefreshPreview} className="rounded border border-[color:var(--color-graphite)] px-2 py-1 text-sm">Сгенерировать другой пример</button>
              </div>
              {preview.length === 0 ? <div className="text-sm text-[color:var(--color-smoke)]">Нажмите «Создать кампанию» на следующем шаге, чтобы увидеть 3 примера.</div> : preview.map((item) => (
                <div key={item.leadId} className="mb-3 rounded border border-[color:var(--color-graphite)] p-3 text-sm">
                  <div className="mb-1 font-medium">{item.leadName}</div>
                  <div className="mb-2 rounded border border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] p-2 text-[color:var(--color-smoke)]">
                    <div className="mb-1 text-xs uppercase tracking-wide text-[color:var(--color-smoke)]">Цитата клиента</div>
                    <div>{item.rawQuote || '—'}</div>
                  </div>
                  <div className="rounded border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] p-2">
                    <div className="mb-1 text-xs uppercase tracking-wide text-[color:var(--color-smoke)]">Сгенерированное сообщение</div>
                    <div>{item.message}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium">Скорость, сообщений/мин</label>
                <input type="number" value={form.pacing} onChange={(event) => setForm((current) => ({ ...current, pacing: Number(event.target.value) }))} className="w-full rounded border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium">Лимит длины</label>
                <input type="number" value={form.maxMessageLength} onChange={(event) => setForm((current) => ({ ...current, maxMessageLength: Number(event.target.value) }))} className="w-full rounded border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm" />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.respectWorkHours} onChange={(event) => setForm((current) => ({ ...current, respectWorkHours: event.target.checked }))} />
              Отправлять только в рабочие часы
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={handleCreateCampaign} className="rounded bg-[color:var(--color-ash)] px-3 py-2 text-sm font-medium text-[color:var(--color-carbon)]">Создать кампанию</button>
              {campaignId ? <button type="button" onClick={handleGenerateMessages} className="rounded border border-[color:var(--color-graphite)] px-3 py-2 text-sm">Сгенерировать для всех</button> : null}
              {campaignId ? <button type="button" onClick={handleApprove} className="rounded border border-[color:var(--color-graphite)] px-3 py-2 text-sm">Одобрить</button> : null}
              {campaignId ? <button type="button" onClick={handleSend} className="rounded border border-[color:var(--color-graphite)] px-3 py-2 text-sm" disabled={approvedReviewCount === 0}>Отправить одобренные</button> : null}
            </div>

            {campaignId && form.requiresApproval ? (
              <div className="rounded border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">Экран проверки</div>
                    <div className="text-sm text-[color:var(--color-smoke)]">Редактируйте текст, одобряйте или пропускайте получателей перед отправкой.</div>
                  </div>
                  <div className="text-sm text-[color:var(--color-smoke)]">{approvedReviewCount} / {reviewRecipients.length} одобрено</div>
                </div>

                {reviewLoading ? <div className="text-sm text-[color:var(--color-smoke)]">Загружаю сообщения...</div> : null}
                {reviewRecipients.length === 0 ? <div className="text-sm text-[color:var(--color-smoke)]">Пока нет сообщений для проверки. Сначала создайте кампанию и сгенерируйте сообщения.</div> : (
                  <div className="space-y-3">
                    {reviewRecipients.map((recipient) => (
                      <div key={recipient.id} className="rounded border border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] p-3">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <div className="font-medium">{recipient.leadName}</div>
                          <div className="flex flex-wrap items-center gap-2">
                            <label className="flex items-center gap-2 text-sm">
                              <input type="checkbox" checked={recipient.status === 'approved'} onChange={() => void handleApproveRecipient(recipient.id)} />
                              Одобрено
                            </label>
                            <button type="button" onClick={() => void handleSkipRecipient(recipient.id)} className="rounded border border-[color:var(--color-graphite)] px-2 py-1 text-sm">Пропустить</button>
                          </div>
                        </div>
                        <textarea value={recipient.generatedMessage} onChange={(event) => setReviewRecipients((current) => current.map((item) => item.id === recipient.id ? { ...item, generatedMessage: event.target.value } : item))} onBlur={() => void handleSaveRecipientMessage(recipient.id, reviewRecipients.find((item) => item.id === recipient.id)?.generatedMessage ?? '')} className="min-h-20 w-full rounded border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm" />
                        <details className="mt-2 text-sm text-[color:var(--color-smoke)]">
                          <summary className="cursor-pointer">Исходный сигнал</summary>
                          <div className="mt-2 rounded border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] p-2">
                            <div>{recipient.signalDescription || '—'}</div>
                            {recipient.rawQuote ? <div className="mt-2 text-xs uppercase tracking-wide">Цитата</div> : null}
                            {recipient.rawQuote ? <div>{recipient.rawQuote}</div> : null}
                          </div>
                        </details>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-6 flex items-center justify-between gap-3">
          <button type="button" onClick={() => setStep((current) => Math.max(1, current - 1))} className="rounded border border-[color:var(--color-graphite)] px-3 py-2 text-sm">Назад</button>
          <button type="button" onClick={handleNextStep} className="rounded bg-[color:var(--color-ash)] px-3 py-2 text-sm font-medium text-[color:var(--color-carbon)]">{step === 4 ? 'Готово' : 'Далее'}</button>
        </div>
      </section>

      <section className="mt-6 rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] p-4">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[color:var(--color-smoke)]">Дашборд кампании</h2>
            <p className="mt-1 text-sm text-[color:var(--color-smoke)]">Карточки по отправкам, ответам, ошибкам и пропускам; список получателей виден сразу по выбранной кампании.</p>
          </div>
          {campaignDashboard ? <div className="rounded border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm">{campaignDashboard.campaign.name}</div> : null}
        </div>
        {dashboardLoading ? <div className="mb-4 text-sm text-[color:var(--color-smoke)]">Загружаю дашборд...</div> : null}
        {campaignDashboard ? (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] p-3">
                <div className="text-sm text-[color:var(--color-smoke)]">Отправлено</div>
                <div className="mt-1 text-2xl font-semibold">{campaignDashboard.stats.sent}</div>
              </div>
              <div className="rounded border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] p-3">
                <div className="text-sm text-[color:var(--color-smoke)]">Ответили</div>
                <div className="mt-1 text-2xl font-semibold">{campaignDashboard.stats.replied}</div>
              </div>
              <div className="rounded border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] p-3">
                <div className="text-sm text-[color:var(--color-smoke)]">Ошибки</div>
                <div className="mt-1 text-2xl font-semibold">{campaignDashboard.stats.errors}</div>
              </div>
              <div className="rounded border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] p-3">
                <div className="text-sm text-[color:var(--color-smoke)]">Пропущено</div>
                <div className="mt-1 text-2xl font-semibold">{campaignDashboard.stats.skipped}</div>
              </div>
            </div>
            <div className="rounded border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] p-3">
              <div className="mb-3 text-sm font-medium">По дням</div>
              <div className="flex h-36 items-end gap-2">
                {campaignDashboard.timeline.map((point) => {
                  const maxHeight = Math.max(1, ...campaignDashboard.timeline.map((item) => item.sent + item.replied + item.failed + item.skipped));
                  const total = point.sent + point.replied + point.failed + point.skipped;
                  const height = maxHeight > 0 ? Math.max(12, (total / maxHeight) * 100) : 12;
                  return (<div key={point.date} className="flex flex-1 flex-col items-center gap-2">
                    <div className="flex h-24 w-full items-end gap-1">
                      <div className="flex-1 rounded-t bg-[color:var(--color-ash)]" style={{ height: `${Math.max(10, (point.sent / Math.max(1, maxHeight)) * 100)}%` }} />
                      <div className="flex-1 rounded-t bg-[color:var(--color-graphite)]" style={{ height: `${Math.max(10, (point.replied / Math.max(1, maxHeight)) * 100)}%` }} />
                    </div>
                    <div className="text-[10px] text-[color:var(--color-smoke)]">{point.label}</div>
                  </div>);
                })}
              </div>
            </div>
            <div className="overflow-hidden rounded border border-[color:var(--color-graphite)]">
              <table className="min-w-full divide-y divide-[color:var(--color-graphite)] text-sm">
                <thead className="bg-[color:var(--color-carbon)] text-left text-[color:var(--color-smoke)]">
                  <tr>
                    <th className="px-3 py-2">Лид</th>
                    <th className="px-3 py-2">Статус</th>
                    <th className="px-3 py-2">Текст</th>
                    <th className="px-3 py-2">Причина</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)]">
                  {campaignDashboard.recipients.map((recipient) => (
                    <tr key={recipient.id}>
                      <td className="px-3 py-2"><a href={`/dashboard/${agentId}/dialogs?leadId=${recipient.leadId}`} className="font-medium text-[color:var(--color-ash)]">{recipient.leadName}</a></td>
                      <td className="px-3 py-2"><span className="rounded-full border border-[color:var(--color-graphite)] px-2 py-0.5 text-xs">{recipient.status}</span></td>
                      <td className="px-3 py-2 text-[color:var(--color-smoke)]">{recipient.generatedMessage || '—'}</td>
                      <td className="px-3 py-2 text-[color:var(--color-smoke)]">{recipient.skipReason || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </section>

      <section className="mt-6 rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[color:var(--color-smoke)]">Список кампаний</h2>
        <div className="space-y-2">
          {campaigns.map((campaign) => (
            <button key={campaign.id} type="button" onClick={() => handleSelectCampaign(campaign.id)} className="flex w-full items-center justify-between rounded border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-left text-sm">
              <div>
                <div className="font-medium">{campaign.name}</div>
                <div className="text-[color:var(--color-smoke)]">{campaign.status} · requires_approval: {campaign.requires_approval ? 'да' : 'нет'}</div>
              </div>
              <div className="text-[color:var(--color-smoke)]">{campaign.created_at}</div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
