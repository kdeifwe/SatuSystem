'use client';

import { useState } from 'react';
import { LOST_REASONS, LOST_REASON_LABELS } from '@/lib/lost-reasons';

type Verdict = {
  leadId: string;
  name: string;
  reason: string;
  label: string;
  note: string;
  confidence: 'high' | 'medium' | 'low';
  lastClientMessage: string;
  lostAt: string;
};

type Row = Verdict & { selected: boolean };

const CONFIDENCE_LABEL: Record<string, string> = { high: 'уверенно', medium: 'вероятно', low: 'неуверенно' };
const EDITABLE_REASONS = LOST_REASONS.filter((r) => r !== 'no_response');

export default function LostAnalysisCard({ agentId, onApplied }: { agentId: string; onApplied: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [processed, setProcessed] = useState<string[]>([]);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [checked, setChecked] = useState(0);
  const [skippedNoReply, setSkippedNoReply] = useState(0);
  const [failed, setFailed] = useState(0);
  const [lastQuick, setLastQuick] = useState<boolean | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedCount = rows.filter((r) => r.selected).length;

  const analyze = async (quick: boolean) => {
    setError(null);
    setMessage(null);
    setAnalyzing(true);
    try {
      const res = await fetch(`/api/agents/${agentId}/classify-lost`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'analyze', limit: quick ? 40 : 25, excludeLeadIds: processed, quick }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Не удалось проанализировать диалоги.');
        return;
      }
      const incoming: Row[] = (data.verdicts as Verdict[]).map((v) => ({ ...v, selected: v.confidence !== 'low' }));
      setRows((current) => [...current, ...incoming]);
      setProcessed((current) => [...current, ...(data.processedLeadIds as string[])]);
      setRemaining(data.remaining as number);
      setChecked((n) => n + (data.processedLeadIds as string[]).length);
      setSkippedNoReply((n) => n + ((data.skippedNoReply as number) ?? 0));
      setFailed((n) => n + ((data.failed as number) ?? 0));
      setLastQuick(quick);

      const checkedNow = (data.processedLeadIds as string[]).length;
      const details = [
        `Проверено: ${checkedNow}`,
        `найдено отказов: ${incoming.length}`,
        data.skippedNoReply ? `клиент не отвечал: ${data.skippedNoReply}` : null,
        data.failed ? `не удалось разобрать: ${data.failed}` : null,
      ]
        .filter(Boolean)
        .join(', ');
      if (checkedNow === 0) {
        setMessage(quick ? 'Диалогов с признаками отказа больше не нашлось.' : 'Новых диалогов для проверки нет.');
      } else {
        setMessage(`${details}.`);
      }
    } catch {
      setError('Ошибка сети, попробуйте ещё раз.');
    } finally {
      setAnalyzing(false);
    }
  };

  const apply = async () => {
    const items = rows
      .filter((r) => r.selected)
      .map((r) => ({ leadId: r.leadId, reason: r.reason, note: r.note, lostAt: r.lostAt }));
    if (items.length === 0) return;

    setError(null);
    setMessage(null);
    setApplying(true);
    try {
      const res = await fetch(`/api/agents/${agentId}/classify-lost`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'apply', items }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Не удалось записать причины.');
        return;
      }
      setRows((current) => current.filter((r) => !r.selected));
      setMessage(`Записано: ${data.applied}${data.skipped ? `, пропущено: ${data.skipped}` : ''}.`);
      onApplied();
    } catch {
      setError('Ошибка сети, попробуйте ещё раз.');
    } finally {
      setApplying(false);
    }
  };

  const update = (leadId: string, patch: Partial<Row>) =>
    setRows((current) => current.map((r) => (r.leadId === leadId ? { ...r, ...patch } : r)));

  return (
    <div className="rounded-2xl border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] p-4">
      <div className="text-sm font-semibold text-[color:var(--color-chalk)]">Разметка старых диалогов</div>
      <p className="mt-1 text-xs text-[color:var(--color-smoke)]">
        ИИ найдёт клиентов, которые явно отказались, и предложит причину. Ничего не записывается, пока вы не подтвердите: можно снять
        галочку или поменять причину. Молчание и «подумаю» отказом не считаются.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => analyze(true)}
          disabled={analyzing || applying}
          className="hyper-primary-btn px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          {analyzing && lastQuick !== false ? 'Ищу...' : 'Быстрый поиск отказов'}
        </button>
        <button
          type="button"
          onClick={() => analyze(false)}
          disabled={analyzing || applying}
          className="rounded-full border border-[color:var(--color-graphite)] px-4 py-2 text-sm text-[color:var(--color-chalk)] transition hover:bg-[color:var(--color-carbon)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {analyzing && lastQuick === false ? 'Анализирую...' : 'Проверить подряд (25)'}
        </button>
        {checked > 0 ? (
          <span className="text-xs text-[color:var(--color-smoke)]">
            Всего проверено: {checked}
            {skippedNoReply > 0 ? `, клиент молчал: ${skippedNoReply}` : ''}
            {failed > 0 ? `, не разобрано: ${failed}` : ''}
            {remaining !== null ? `, осталось в выборке: ${remaining}` : ''}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-[11px] text-[color:var(--color-smoke)]">
        «Быстрый поиск» читает ИИ только диалоги, где клиент писал слова вроде «не надо», «дорого», «керек емес». «Проверить подряд» идёт по всем
        диалогам и находит и неявные отказы, но дольше.
      </p>

      {error ? <p className="mt-2 text-sm text-rose-600">{error}</p> : null}
      {message ? <p className="mt-2 text-sm text-[color:var(--color-chalk)]">{message}</p> : null}

      {rows.length > 0 ? (
        <div className="mt-4 space-y-2">
          {rows.map((row) => (
            <div key={row.leadId} className="rounded-xl border border-[color:var(--color-graphite)] p-3">
              <div className="flex items-start gap-3">
                <input type="checkbox" className="mt-1" checked={row.selected} onChange={(e) => update(row.leadId, { selected: e.target.checked })} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-[color:var(--color-chalk)]">{row.name}</span>
                    <span className="text-[11px] text-[color:var(--color-smoke)]">{CONFIDENCE_LABEL[row.confidence]}</span>
                  </div>
                  <div className="mt-1 truncate text-xs text-[color:var(--color-smoke)]">«{row.lastClientMessage}»</div>
                  {row.note ? <div className="mt-1 text-xs text-[color:var(--color-chalk)]">{row.note}</div> : null}
                  <select
                    value={row.reason}
                    onChange={(e) => update(row.leadId, { reason: e.target.value })}
                    className="hyper-input mt-2 px-3 py-1.5 text-xs"
                  >
                    {EDITABLE_REASONS.map((reason) => (
                      <option key={reason} value={reason}>
                        {LOST_REASON_LABELS[reason]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={apply}
            disabled={applying || analyzing || selectedCount === 0}
            className="hyper-primary-btn w-full px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {applying ? 'Записываю...' : `Записать выбранные (${selectedCount})`}
          </button>
        </div>
      ) : null}
    </div>
  );
}
