'use client';

import { useMemo, useState } from 'react';
import {
  BellRing,
  BriefcaseBusiness,
  CalendarClock,
  ChevronRight,
  RefreshCw,
  Sparkles,
  SplitSquareHorizontal,
  TimerReset,
  ToggleLeft,
  X,
  type LucideIcon,
} from 'lucide-react';

type ExtensionKey =
  | 'telegram_notifications'
  | 'repeat_touches'
  | 'auto_switch'
  | 'working_hours'
  | 'scheduled_messages'
  | 'message_delay'
  | 'message_splitting';

type ExtensionItem = {
  key: ExtensionKey;
  title: string;
  description: string;
  active: boolean;
  accent: string;
  meta: string;
  details: string;
  icon: LucideIcon;
};

const initialExtensions: ExtensionItem[] = [
  {
    key: 'telegram_notifications',
    title: 'Уведомления в Telegram',
    description: 'Пуши команде о новых сообщениях, запросах помощи и ключевых статусах сделки.',
    active: true,
    accent: 'from-fuchsia-500/20 via-violet-500/10 to-slate-950',
    meta: 'Пошаговые уведомления',
    details: 'Срабатывает на новые сообщения, обращения в help_request и кастомные триггеры по смене статуса лида.',
    icon: BellRing,
  },
  {
    key: 'repeat_touches',
    title: 'Повторные касания',
    description: 'Автоматически возвращает лидов в работу после паузы, чтобы не терять диалог.',
    active: true,
    accent: 'from-emerald-500/20 via-teal-500/10 to-slate-950',
    meta: 'Сбрасывает счётчик после входящего',
    details: 'Проверяет, не писал ли лид сам, и заново активирует цепочку повторных контактов в нужный момент.',
    icon: RefreshCw,
  },
  {
    key: 'auto_switch',
    title: 'Автопереключение диалогов',
    description: 'Пауза AI и передача диалога оператору по правилам takeover.',
    active: false,
    accent: 'from-cyan-500/20 via-sky-500/10 to-slate-950',
    meta: 'AI ⇄ оператор',
    details: 'Складывает паузу по операторскому takeover, чтобы AI не продолжал генерировать ответ в неподходящий момент.',
    icon: Sparkles,
  },
  {
    key: 'working_hours',
    title: 'График работы',
    description: 'Ограничивает ответы агентом рабочими часами и подменяет поведение.',
    active: false,
    accent: 'from-amber-500/20 via-orange-500/10 to-slate-950',
    meta: 'Часы и очереди',
    details: 'Поддерживает silent, auto_reply, queue_for_open и notify_operator в зависимости от времени и часового пояса.',
    icon: BriefcaseBusiness,
  },
  {
    key: 'scheduled_messages',
    title: 'Запланированные сообщения',
    description: 'Отправка сообщений по расписанию и по триггерам из сценариев.',
    active: true,
    accent: 'from-blue-500/20 via-indigo-500/10 to-slate-950',
    meta: 'Queue и retry',
    details: 'Поддерживает очередь отправки для рабочих окон и ручных запусков по событию.',
    icon: CalendarClock,
  },
  {
    key: 'message_delay',
    title: 'Задержка сообщений',
    description: 'Накладывает паузы между фрагментами ответов и помогает сделать диалог живым.',
    active: false,
    accent: 'from-rose-500/20 via-pink-500/10 to-slate-950',
    meta: 'Паузы между сообщениями',
    details: 'Можно задать задержку на каждую часть ответа и подать визуальный статус “печатает…”.',
    icon: TimerReset,
  },
  {
    key: 'message_splitting',
    title: 'Разделение сообщения на части',
    description: 'Разбивает длинный ответ AI на несколько коротких сообщений по правилам.',
    active: false,
    accent: 'from-purple-500/20 via-fuchsia-500/10 to-slate-950',
    meta: 'Части и группы',
    details: 'Объединяет части в один logical response и добавляет метки split_group_id и split_part_index.',
    icon: SplitSquareHorizontal,
  },
];

export default function ExtensionsPage({ params }: { params: { agentId: string } }) {
  const [extensions, setExtensions] = useState<ExtensionItem[]>(initialExtensions);
  const [selectedKey, setSelectedKey] = useState<ExtensionKey | null>(null);

  const selectedExtension = useMemo(
    () => extensions.find((item) => item.key === selectedKey) ?? null,
    [extensions, selectedKey]
  );

  const activeCount = useMemo(() => extensions.filter((item) => item.active).length, [extensions]);

  const toggleExtension = (key: ExtensionKey) => {
    setExtensions((current) =>
      current.map((item) => (item.key === key ? { ...item, active: !item.active } : item))
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.3em] text-slate-400">Расширения</p>
          <h1 className="mt-2 text-3xl font-semibold text-white">Настройки поведения агента</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">
            Агент {params.agentId} получает отдельные правила для Telegram, повторных касаний, пауз, очередей и разбивки ответов.
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-3 shadow-lg shadow-black/20">
          <div className="text-sm text-slate-400">Активно</div>
          <div className="mt-1 text-2xl font-semibold text-white">
            {activeCount}/{extensions.length}
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {extensions.slice(0, 2).map((extension) => {
          const Icon = extension.icon;
          return (
            <button
              key={extension.key}
              type="button"
              onClick={() => setSelectedKey(extension.key)}
              className={`group rounded-3xl border border-white/10 bg-gradient-to-br p-6 text-left shadow-lg shadow-black/20 transition hover:-translate-y-1 hover:border-cyan-400/40 ${extension.accent}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
                    <span className="rounded-full border border-white/10 bg-white/5 p-2">
                      <Icon className="h-4 w-4" />
                    </span>
                    {extension.meta}
                  </div>
                  <h2 className="mt-4 text-xl font-semibold text-white">{extension.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{extension.description}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${extension.active ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-700/70 text-slate-300'}`}>
                  {extension.active ? 'Активно' : 'Выключено'}
                </span>
              </div>
              <div className="mt-6 flex items-center justify-between text-sm text-slate-300">
                <span>Открыть настройки</span>
                <ChevronRight className="h-4 w-4 transition group-hover:translate-x-1" />
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {extensions.slice(2).map((extension) => {
          const Icon = extension.icon;
          return (
            <button
              key={extension.key}
              type="button"
              onClick={() => setSelectedKey(extension.key)}
              className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 text-left shadow-lg shadow-black/20 transition hover:-translate-y-1 hover:border-white/20"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="rounded-full border border-white/10 bg-white/5 p-2 text-slate-200">
                  <Icon className="h-4 w-4" />
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${extension.active ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-700/70 text-slate-300'}`}>
                  {extension.active ? 'Активно' : 'Отключено'}
                </span>
              </div>
              <h3 className="mt-4 text-lg font-semibold text-white">{extension.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-400">{extension.description}</p>
              <div className="mt-4 flex items-center text-sm text-slate-300">
                <span>Настроить</span>
                <ChevronRight className="ml-2 h-4 w-4" />
              </div>
            </button>
          );
        })}
      </div>

      {selectedExtension && (
        <div className="fixed inset-0 z-50 flex items-start justify-end bg-slate-950/80 p-4 sm:p-6">
          <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-slate-950 p-6 shadow-2xl shadow-black/50">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium text-slate-400">
                  <span className="rounded-full border border-white/10 bg-white/5 p-2 text-slate-200">
                    {(() => {
                      const Icon = selectedExtension.icon;
                      return <Icon className="h-4 w-4" />;
                    })()}
                  </span>
                  {selectedExtension.meta}
                </div>
                <h2 className="mt-3 text-2xl font-semibold text-white">{selectedExtension.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">{selectedExtension.description}</p>
              </div>

              <button
                type="button"
                onClick={() => setSelectedKey(null)}
                className="rounded-full border border-white/10 bg-white/5 p-2 text-slate-300 transition hover:bg-white/10"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-6 space-y-4">
              <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm text-slate-400">Состояние</div>
                    <div className="mt-1 text-base font-medium text-white">
                      {selectedExtension.active ? 'Включено' : 'Отключено'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleExtension(selectedExtension.key)}
                    className={`flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition ${selectedExtension.active ? 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/20' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'}`}
                  >
                    <ToggleLeft className="h-4 w-4" />
                    {selectedExtension.active ? 'Отключить' : 'Включить'}
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                <div className="text-sm text-slate-400">Что делает расширение</div>
                <p className="mt-2 text-sm leading-6 text-slate-300">{selectedExtension.details}</p>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setSelectedKey(null)}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10"
              >
                Закрыть
              </button>
              <button
                type="button"
                onClick={() => toggleExtension(selectedExtension.key)}
                className="rounded-full bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-cyan-400"
              >
                {selectedExtension.active ? 'Сохранить выключение' : 'Сохранить включение'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
