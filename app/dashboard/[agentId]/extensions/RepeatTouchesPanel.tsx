'use client';

import { useEffect, useState } from 'react';
import { ToggleLeft } from 'lucide-react';
import { getRepeatTouchesSettings, saveRepeatTouchesSettings } from './repeat-touches-actions';
import { DEFAULT_REPEAT_TOUCHES_CONFIG, MAX_TOUCHES, type RepeatTouchesConfig } from '@/lib/server/follow-ups/config';

const card = 'rounded-2xl border border-white/10 bg-slate-900/70 p-4';
const input =
  'w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/50';

export default function RepeatTouchesPanel({ agentId }: { agentId: string }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const [cfg, setCfg] = useState<RepeatTouchesConfig>(DEFAULT_REPEAT_TOUCHES_CONFIG);
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
        setStatusesText(result.config.stop_statuses.join(', '));
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const touches = cfg.schedule_hours.length;

  const setTouchCount = (count: number) => {
    const next = [...cfg.schedule_hours];
    while (next.length < count) next.push(next.length === 0 ? 3 : Math.max(24, next[next.length - 1] * 2));
    setCfg({ ...cfg, schedule_hours: next.slice(0, count) });
  };

  const setDelay = (index: number, value: number) => {
    const next = [...cfg.schedule_hours];
    next[index] = Math.min(168, Math.max(1, Math.round(value) || 1));
    setCfg({ ...cfg, schedule_hours: next });
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
          {cfg.schedule_hours.map((hours, index) => (
            <div key={index}>
              <label className="block text-xs text-slate-400">
                Касание №{index + 2}: через сколько часов тишины после {index === 0 ? 'последнего ответа агента' : 'предыдущего касания'}
              </label>
              <input type="number" min={1} max={168} className={input} value={hours} onChange={(e) => setDelay(index, Number(e.target.value))} />
            </div>
          ))}
        </div>
      </div>

      <div className={card}>
        <div className="text-sm font-medium text-white">Когда можно писать (время организации)</div>
        <div className="mt-3 flex items-center gap-3">
          <input type="number" min={0} max={23} className={input} value={cfg.window_start_hour} onChange={(e) => setCfg({ ...cfg, window_start_hour: Number(e.target.value) })} />
          <span className="text-slate-400">—</span>
          <input type="number" min={1} max={24} className={input} value={cfg.window_end_hour} onChange={(e) => setCfg({ ...cfg, window_end_hour: Number(e.target.value) })} />
        </div>
        <p className="mt-2 text-xs text-slate-400">Вне этого окна касания не отправляются, они уйдут при следующем окне.</p>
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
            {cfg.schedule_hours.map((_, index) => (
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
