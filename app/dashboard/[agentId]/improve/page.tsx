'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import LostAnalysisCard from './LostAnalysisCard';
import { useSearchParams } from 'next/navigation';
import { Sparkles, FileText, AlertCircle, CheckCircle2, AlertTriangle, AlertOctagon } from 'lucide-react';
import { ImproveTabs } from './tabs';

type CriticismData = {
  root_cause: string;
  severity: 'critical' | 'major' | 'minor';
};

interface ImprovementResult {
  improved_prompt: string;
  patches: Array<{ search: string; replace: string; reason: string }>;
  changes_summary: string;
  key_improvements: string[];
  criticism: CriticismData;
  is_valid: boolean;
  current_prompt: string;
}

type LostStat = { reason: string; label: string; count: number; share: number; fixable: boolean };
type LostStatsResponse = { total: number; days: number; reasons: LostStat[] };

export default function ImprovePage({ params }: { params: { agentId: string } }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [feedback, setFeedback] = useState('');
  const [result, setResult] = useState<ImprovementResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [lostStats, setLostStats] = useState<LostStatsResponse | null>(null);
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [statsVersion, setStatsVersion] = useState(0);

  useEffect(() => {
    const feedbackParam = searchParams.get('feedback');
    if (feedbackParam) {
      setFeedback(decodeURIComponent(feedbackParam));
    }
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/agents/${params.agentId}/lost-reasons`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as LostStatsResponse;
        if (!cancelled) setLostStats(data);
      } catch {
        // причины отказов необязательны для работы страницы
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.agentId, statsVersion]);

  const pickReason = (stat: LostStat) => {
    if (!lostStats) return;
    setSelectedReason(stat.reason);
    setFeedback(
      `За последние ${lostStats.days} дней потеряно диалогов: ${lostStats.total}. Причина «${stat.label}» встречается у ${stat.count} (${stat.share}%). ` +
        'Проанализируй эти реальные отказы и улучши работу агента так, чтобы чаще удерживать клиента.',
    );
  };

  const handleSubmit = async () => {
    if (!feedback.trim()) {
      setError('Опишите, пожалуйста, что нужно изменить.');
      return;
    }

    setError(null);
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch(`/api/agents/${params.agentId}/improve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback, lost_reason: selectedReason }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Не удалось получить улучшение.');
        return;
      }

      setResult(data);
    } catch (err) {
      setError('Ошибка соединения. Попробуйте позже.');
    } finally {
      setLoading(false);
    }
  };

  const applyChanges = async () => {
    if (!result) return;
    setApplying(true);
    setError(null);

    try {
      const res = await fetch(`/api/agents/${params.agentId}/apply-improvement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patches: result.patches,
          change_note: result.changes_summary,
          current_prompt: result.current_prompt,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Не удалось применить изменения.');
        return;
      }

      // Показываем toast и редиректим в sandbox
      setTimeout(() => {
        router.push(`/dashboard/${params.agentId}/sandbox`);
      }, 1500);
    } catch {
      setError('Ошибка при применении изменений.');
    } finally {
      setApplying(false);
    }
  };

  const getSeverityBadge = (severity?: string) => {
    switch (severity) {
      case 'critical':
        return { icon: AlertOctagon, label: 'Критично', color: 'bg-red-50 text-red-700' };
      case 'major':
        return { icon: AlertTriangle, label: 'Важно', color: 'bg-amber-50 text-amber-700' };
      case 'minor':
      default:
        return { icon: AlertCircle, label: 'Незначительно', color: 'bg-blue-50 text-blue-700' };
    }
  };

  const severityInfo = getSeverityBadge(result?.criticism?.severity);
  const SeverityIcon = severityInfo.icon;

  return (
    <div className="hyper-dashboard-shell flex h-full flex-col">
      <div className="border-b border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] px-6 py-4">
        <ImproveTabs agentId={params.agentId} />
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-3xl">
          {!result ? (
            <div className="rounded-[var(--radius-2xl)] border border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] px-10 py-14 text-center shadow-sm">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] text-[color:var(--color-chalk)]">
                <Sparkles className="h-8 w-8" />
              </div>
              <h1 className="mt-6 text-2xl font-semibold text-[color:var(--color-chalk)]">Что вы хотите изменить в вашем ИИ-агенте?</h1>
              <p className="mt-3 text-sm text-[color:var(--color-smoke)]">Опишите проблему, и я помогу улучшить промпт агента.</p>

              <div className="mt-10 space-y-6 text-left">
                <LostAnalysisCard agentId={params.agentId} onApplied={() => setStatsVersion((v) => v + 1)} />
                {lostStats && lostStats.total > 0 ? (
                  <div className="rounded-2xl border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] p-4">
                    <div className="text-sm font-semibold text-[color:var(--color-chalk)]">Почему клиенты не купили ({lostStats.days} дней)</div>
                    <p className="mt-1 text-xs text-[color:var(--color-smoke)]">
                      Потеряно диалогов: {lostStats.total}. Нажмите на причину, чтобы улучшить агента по реальным отказам.
                    </p>
                    <div className="mt-3 space-y-2">
                      {lostStats.reasons.map((stat) => (
                        <button
                          key={stat.reason}
                          type="button"
                          disabled={!stat.fixable}
                          onClick={() => pickReason(stat)}
                          title={stat.fixable ? undefined : 'Эта причина связана не с промптом агента'}
                          className={`block w-full rounded-xl border px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
                            selectedReason === stat.reason
                              ? 'border-[color:var(--color-chalk)] bg-[color:var(--color-carbon)]'
                              : 'border-[color:var(--color-graphite)] hover:bg-[color:var(--color-carbon)]'
                          }`}
                        >
                          <div className="flex items-center justify-between text-[color:var(--color-chalk)]">
                            <span>{stat.label}</span>
                            <span className="text-xs text-[color:var(--color-smoke)]">
                              {stat.count} · {stat.share}%
                            </span>
                          </div>
                          <div className="mt-2 h-1.5 w-full rounded-full bg-[color:var(--color-graphite)]">
                            <div className="h-1.5 rounded-full bg-[color:var(--color-chalk)]" style={{ width: `${Math.max(4, stat.share)}%` }} />
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div>
                  <label className="text-sm font-semibold text-[color:var(--color-chalk)]">Опишите задачу</label>
                  <textarea
                    value={feedback}
                    onChange={(event) => setFeedback(event.target.value)}
                    placeholder="Например: агент слишком формальный, нужно добавить больше вопросов о бюджете..."
                    rows={6}
                    className="hyper-input mt-3 min-h-[160px] px-4 py-4 text-sm"
                  />
                  {error ? <p className="mt-2 text-sm text-rose-600">{error}</p> : null}
                </div>

                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={loading}
                  className="hyper-primary-btn w-full px-6 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? 'Анализирую...' : 'Отправить'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Блок проблемы */}
              <div className={`rounded-3xl border p-6 shadow-sm ${severityInfo.color} bg-opacity-20`}>
                <div className="flex items-start gap-4">
                  <SeverityIcon className="mt-1 h-6 w-6 flex-shrink-0" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-semibold text-slate-900">Что было не так</h2>
                      <span className={`rounded-full px-3 py-1 text-xs font-medium ${severityInfo.color}`}>
                        {severityInfo.label}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-slate-700">{result.criticism?.root_cause}</p>
                  </div>
                </div>
              </div>

              {/* Блок улучшений */}
              <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
                <div className="flex items-start gap-4">
                  <CheckCircle2 className="mt-1 h-6 w-6 flex-shrink-0 text-emerald-600" />
                  <div className="flex-1">
                    <h2 className="text-lg font-semibold text-emerald-900">Что изменилось</h2>
                    <p className="mt-2 text-sm leading-relaxed text-emerald-800">{result.changes_summary}</p>

                    {result.patches && result.patches.length > 0 ? (
                      <div className="mt-4 rounded-2xl border border-emerald-200 bg-white/70 px-4 py-3 text-sm text-emerald-800">
                        <span className="font-semibold">Точечные патчи:</span> {result.patches.length} правок для текущего промпта.
                      </div>
                    ) : null}

                    {result.key_improvements && result.key_improvements.length > 0 ? (
                      <ul className="mt-4 space-y-2">
                        {result.key_improvements.map((improvement, index) => (
                          <li key={index} className="flex items-start gap-2 text-sm text-emerald-800">
                            <span className="mt-1 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white text-xs">
                              ✓
                            </span>
                            <span>{improvement}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* Кнопки действий */}
              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={applyChanges}
                  disabled={applying}
                  className="flex-1 rounded-3xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {applying ? 'Применяю...' : '✓ Применить изменения'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setResult(null);
                    setFeedback('');
                  }}
                  className="flex-1 rounded-3xl border border-gray-200 bg-white px-6 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
                >
                  ✕ Отклонить
                </button>
              </div>

              {/* Toast уведомление при применении */}
              {applying ? (
                <div className="rounded-3xl border border-blue-200 bg-blue-50 px-5 py-3 text-sm text-blue-900">
                  ⏳ Применяю изменения... Сейчас перенаправлю в песочницу.
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
