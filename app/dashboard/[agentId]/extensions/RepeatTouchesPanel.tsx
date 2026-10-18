'use client';

import { useEffect, useState } from 'react';
import { ToggleLeft } from 'lucide-react';
import { getRepeatTouchesSettings, saveRepeatTouchesSettings } from './repeat-touches-actions';
import {
  DEFAULT_REPEAT_TOUCHES_CONFIG,
  MAX_DELAY_MINUTES,
  MAX_TOUCHES,
  type RepeatTouchesConfig,
} from '@/lib/server/follow-ups/config';

type DelayRow = { value: number; unit: 'min' | 'h' };

function minutesToRow(minutes: number): DelayRow {
  return minutes >= 60 && minutes % 60 === 0 ? { value: minutes / 60, unit: 'h' } : { value: minutes, unit: 'min' };
}

function rowToMinutes(row: DelayRow): number {
  const minutes = row.unit === 'h' ? row.value * 60 : row.value;
  return Math.min(MAX_DELAY_MINUTES, Math.max(1, Math.round(minutes) || 1));
}

const card = 'rounded-2xl border border-white/10 bg-slate-900/70 p-4';
const input =
  'w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/50';

export default function RepeatTouchesPanel({ agentId }: { agentId: string }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const [cfg, setCfg] = useState<RepeatTouchesConfig>(DEFAULT_REPEAT_TOUCHES_CONFIG);
  const [rows, setRows] = useState<DelayRow[]>(DEFAULT_REPEAT_TOUCHES_CONFIG.schedule_minutes.map(minutesToRow));
  const [statusesText, setStatusesText] = useState(DEFAULT_REPEAT_TOUCHES_CONFIG.stop_statuses.join(', '));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await getRepeatTouchesSettings(agentId);
      if (cancelled) return;
      if ('error' in result) {
        setMessage(result.error);
      } else {
        setActive(result.is_active);
        setCfg(result.config);
        setRows(result.config.schedule_minutes.map(minutesToRow));
        setStatusesText(result.config.stop_statuses.join(', '));
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const touches = rows.length;

  const setTouchCount = (count: number) => {
    const next = [...rows];
    while (next.length < count) next.push(next.length === 0 ? { value: 3, unit: 'h' } : { value: 24, unit: 'h' });
    setRows(next.slice(0, count));
  };

  const setRow = (index: number, patch: Partial<DelayRow>) => {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const setTemplate = (index: number, value: string) => {
    const next = [...cfg.fixed_templates];
    while (next.length <= index) next.push('');
    next[index] = value;
    setCfg({ ...cfg, fixed_templates: next });
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    const result = await saveRepeatTouchesSettings(agentId, {
      is_active: active,
      config: {
        ...cfg,
        schedule_minutes: rows.map(rowToMinutes),
        stop_statuses: statusesText.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
      },
    });
    setSaving(false);
    setMessage('error' in result ? result.error : 'Сохранено');
  };

  if (loading) return <div className="mt-6 text-sm text-slate-400">Загрузка…</div>;

  return (
    <div className="mt-6 space-y-4">
      <div className={card}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm text-slate-400">Состояние</div>
            <div className="mt-1 text-base font-medium text-white">{active ? 'Включено' : 'Отключено'}</div>
          </div>
          <button
            type="button"
            onClick={() => setActive((v) => !v)}
            className={`flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition ${active ? 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/20' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'}`}
          >
            <ToggleLeft className="h-4 w-4" />
            {active ? 'Отключить' : 'Включить'}
          </button>
        </div>
        <p className="mt-3 text-xs leading-5 text-slate-400">
          Касание №1 — первый ответ агента. Если клиент замолчал, агент напишет касание №2, №3 по расписанию ниже. Как только клиент
          ответит, цепочка сбрасывается. Действует только на диалоги, где последнее сообщение агента появилось после включения.
        </p>
      </div>

      <div className={card}>
        <div className="text-sm font-medium text-white">Расписание</div>
        <label className="mt-3 block text-xs text-slate-400">Сколько повторных касаний</label>
        <select className={input} value={touches} onChange={(e) => setTouchCount(Number(e.target.value))}>
          {Array.from({ length: MAX_TOUCHES }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n} (касания №2{n > 1 ? `–№${n + 1}` : ''})
            </option>
          ))}
        </select>
        <div className="mt-3 space-y-3">
          {rows.map((row, index) => (
            <div key={index}>
              <label className="block text-xs text-slate-400">
                Касание №{index + 2}: через сколько тишины после {index === 0 ? 'последнего ответа агента' : 'предыдущего касания'}
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={1}
                  className={input}
                  value={row.value}
                  onChange={(e) => setRow(index, { value: Number(e.target.value) })}
                />
                <select
                  className={`${input} w-32`}
                  value={row.unit}
                  onChange={(e) => setRow(index, { unit: e.target.value as DelayRow['unit'] })}
                >
                  <option value="min">минут</option>
                  <option value="h">часов</option>
                </select>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-400">Минимум 1 минута, максимум 7 суток. Для быстрой проверки поставьте 1–2 минуты.</p>
      </div>

      <div className={card}>
        <div className="text-sm font-medium text-white">Когда можно писать (время организации)</div>
        <div className="mt-3 flex items-center gap-3">
          <input type="number" min={0} max={23} className={input} value={cfg.window_start_hour} onChange={(e) => setCfg({ ...cfg, window_start_hour: Number(e.target.value) })} />
          <span className="text-slate-400">—</span>
          <input type="number" min={1} max={24} className={input} value={cfg.window_end_hour} onChange={(e) => setCfg({ ...cfg, window_end_hour: Number(e.target.value) })} />
        </div>
        <p className="mt-2 text-xs text-slate-400">Вне этого окна касания не отправляются, они уйдут при следующем окне. Для теста поставьте 0 — 24.</p>
      </div>

      <div className={card}>
        <div className="text-sm font-medium text-white">Текст касаний</div>
        <select className={`${input} mt-3`} value={cfg.message_mode} onChange={(e) => setCfg({ ...cfg, message_mode: e.target.value as RepeatTouchesConfig['message_mode'] })}>
          <option value="ai_generated">Пишет ИИ по контексту диалога (рекомендуется)</option>
          <option value="fixed_templates">Фиксированные шаблоны</option>
        </select>
        {cfg.message_mode === 'ai_generated' ? (
          <p className="mt-2 text-xs leading-5 text-slate-400">
            ИИ учитывает историю диалога и стиль агента, не повторяется и не выдумывает акции. Если клиент отказался или уже записался,
            касание не отправляется.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {rows.map((_, index) => (
              <div key={index}>
                <label className="block text-xs text-slate-400">Текст касания №{index + 2} (можно {'{{name}}'} для имени)</label>
                <textarea rows={3} className={input} value={cfg.fixed_templates[index] ?? ''} onChange={(e) => setTemplate(index, e.target.value)} />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={card}>
        <div className="text-sm font-medium text-white">Когда не трогать</div>
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-200">
          <input type="checkbox" checked={cfg.stop_if_ai_disabled} onChange={(e) => setCfg({ ...cfg, stop_if_ai_disabled: e.target.checked })} />
          Если ИИ выключен для лида
        </label>
        <label className="mt-3 block text-xs text-slate-400">Статусы лидов, которым не пишем (через запятую)</label>
        <input className={input} value={statusesText} onChange={(e) => setStatusesText(e.target.value)} />
      </div>

      <div className="flex items-center justify-end gap-3">
        {message && <span className="text-sm text-slate-300">{message}</span>}
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-60"
        >
          {saving ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </div>
    </div>
  );
}
