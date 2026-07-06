'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Sparkles, FileText, AlertCircle, CheckCircle2, AlertTriangle, AlertOctagon, Workflow } from 'lucide-react';

type CriticismData = {
  root_cause: string;
  severity: 'critical' | 'major' | 'minor';
};

interface ImprovementResult {
  improved_prompt: string;
  changes_summary: string;
  key_improvements: string[];
  criticism: CriticismData;
  is_valid: boolean;
  current_prompt: string;
}

export default function ImprovePage({ params }: { params: { agentId: string } }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [feedback, setFeedback] = useState('');
  const [result, setResult] = useState<ImprovementResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    const feedbackParam = searchParams.get('feedback');
    if (feedbackParam) {
      setFeedback(decodeURIComponent(feedbackParam));
    }
  }, [searchParams]);

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
        body: JSON.stringify({ feedback }),
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
          improved_prompt: result.improved_prompt,
          change_note: result.changes_summary,
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
    <div className="flex h-full flex-col bg-slate-50">
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
          <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-700">Улучшение</span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-500">Скрипт продаж</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-3xl">
          {!result ? (
            <div className="rounded-3xl border border-dashed border-slate-200 bg-white px-10 py-14 text-center shadow-sm">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                <Sparkles className="h-8 w-8" />
              </div>
              <h1 className="mt-6 text-2xl font-semibold text-slate-900">Что вы хотите изменить в вашем ИИ-агенте?</h1>
              <p className="mt-3 text-sm text-slate-500">Опишите проблему, и я помогу улучшить промпт агента.</p>

              <div className="mt-10 space-y-6 text-left">
                <div>
                  <label className="text-sm font-semibold text-slate-900">Опишите задачу</label>
                  <textarea
                    value={feedback}
                    onChange={(event) => setFeedback(event.target.value)}
                    placeholder="Например: агент слишком формальный, нужно добавить больше вопросов о бюджете..."
                    rows={6}
                    className="mt-3 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-900 outline-none focus:border-blue-300"
                  />
                  {error ? <p className="mt-2 text-sm text-rose-600">{error}</p> : null}
                </div>

                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={loading}
                  className="w-full rounded-3xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? 'Анализирую...' : 'Отправить'}
                </button>

                <button
                  type="button"
                  onClick={() => router.push(`/dashboard/${params.agentId}/improve/flow`)}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-3xl border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  <Workflow className="h-4 w-4" />
                  Открыть конструктор воронки
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
