'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { QRCodeSVG } from 'qrcode.react';
import {
  BellRing,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock3,
  ExternalLink,
  RefreshCw,
  Sparkles,
  SplitSquareHorizontal,
  TimerReset,
  ToggleLeft,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  disconnectTelegramProfile,
  generateTelegramLinkToken,
  getTelegramExtensionData,
  saveExtensionSettings,
  type TelegramExtensionData,
  type TelegramExtensionSettings,
  type TelegramMember,
} from './actions';
import { getDefaultConfig } from '../../../../lib/telegram-extension-config';

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

type TelegramLinkState = {
  profileId: string;
  link: string;
  expiresAt: string;
};

type AgentSettings = {
  general_capabilities?: {
    kaspi_invoice_enabled?: boolean;
    [key: string]: unknown;
  };
};

function patchEventConfig(
  current: TelegramExtensionSettings,
  eventKey: string,
  update: (values: Record<string, any>) => Record<string, any>
): TelegramExtensionSettings {
  const currentEvents = (current?.events ?? {}) as Record<string, any>;

  return getDefaultConfig({
    ...current,
    events: {
      ...currentEvents,
      [eventKey]: update((currentEvents[eventKey] ?? {}) as Record<string, any>),
    },
  }) as TelegramExtensionSettings;
}

const defaultTelegramConfig = (): TelegramExtensionSettings => getDefaultConfig();

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
  const [telegramData, setTelegramData] = useState<TelegramExtensionData | null>(null);
  const [telegramLink, setTelegramLink] = useState<TelegramLinkState | null>(null);
  const [linkBusyProfileId, setLinkBusyProfileId] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [draftRecipients, setDraftRecipients] = useState<string[]>([]);
  const [draftConfig, setDraftConfig] = useState<TelegramExtensionSettings>(() => getDefaultConfig());
  const [showConditionForm, setShowConditionForm] = useState(false);
  const [newCondition, setNewCondition] = useState({
    value: '',
    template: '{{lead.name}} сменил статус на {{lead.status}}',
  });
  const [countdownLabel, setCountdownLabel] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingAgentSettings, setIsSavingAgentSettings] = useState(false);
  const [agentSettingsSaveError, setAgentSettingsSaveError] = useState<string | null>(null);

  const { data: agentSettings, error: agentSettingsError, mutate: mutateAgentSettings } = useSWR<AgentSettings>(
    ['agent-settings', params.agentId],
    async () => {
      const response = await fetch(`/api/agents/${params.agentId}/settings`);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Не удалось загрузить настройки агента');
      }
      return payload as AgentSettings;
    },
    { revalidateOnFocus: false }
  );

  const kaspiInvoiceEnabled = agentSettings?.general_capabilities?.kaspi_invoice_enabled === true;
  const isLoadingAgentSettings = !agentSettings && !agentSettingsError;

  const handleToggleKaspiInvoice = async () => {
    setIsSavingAgentSettings(true);
    setAgentSettingsSaveError(null);

    const nextValue = !kaspiInvoiceEnabled;
    const response = await fetch(`/api/agents/${params.agentId}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ general_capabilities: { kaspi_invoice_enabled: nextValue } }),
    });

    const payload = await response.json();
    if (!response.ok) {
      setAgentSettingsSaveError(payload?.error ?? 'Не удалось сохранить настройку');
      setIsSavingAgentSettings(false);
      return;
    }

    setIsSavingAgentSettings(false);
    await mutateAgentSettings();
  };

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

  const refreshTelegramData = async () => {
    const result = await getTelegramExtensionData(params.agentId);
    setTelegramData(result);
    setDraftRecipients(result.recipients ?? []);
    setDraftConfig(getDefaultConfig(result.config));
    return result;
  };

  useEffect(() => {
    if (selectedKey !== 'telegram_notifications') {
      return;
    }

    void refreshTelegramData();
  }, [params.agentId, selectedKey]);

  useSWR(
    selectedKey === 'telegram_notifications' ? ['telegram-extension', params.agentId] : null,
    () => getTelegramExtensionData(params.agentId),
    {
      refreshInterval: 5000,
      revalidateOnFocus: false,
      onSuccess: (data) => {
        setTelegramData(data);
      },
    }
  );

  useEffect(() => {
    if (!telegramLink?.expiresAt) {
      setCountdownLabel('');
      return;
    }

    const updateCountdown = () => {
      const diffMs = new Date(telegramLink.expiresAt).getTime() - Date.now();
      const minutes = Math.max(0, Math.ceil(diffMs / 60000));
      setCountdownLabel(diffMs > 0 ? `истекает через ${minutes} ${minutes === 1 ? 'минуту' : 'минут'}` : 'ссылка истекла');
    };

    updateCountdown();
    const timer = window.setInterval(updateCountdown, 30000);
    return () => window.clearInterval(timer);
  }, [telegramLink?.expiresAt]);

  const handleConnectMember = async (profileId: string) => {
    setLinkError(null);
    setLinkBusyProfileId(profileId);
    const result = await generateTelegramLinkToken(profileId);
    if (result.error) {
      setLinkError(result.error);
      setLinkBusyProfileId(null);
      return;
    }

    setTelegramLink({
      profileId,
      link: result.link ?? '',
      expiresAt: result.expiresAt ?? '',
    });
    setLinkBusyProfileId(null);
    await refreshTelegramData();
  };

  const handleDisconnectMember = async (profileId: string) => {
    setLinkError(null);
    await disconnectTelegramProfile(profileId);
    setTelegramLink(null);
    await refreshTelegramData();
  };

  const handleToggleRecipient = (profileId: string) => {
    setDraftRecipients((current) =>
      current.includes(profileId) ? current.filter((item) => item !== profileId) : [...current, profileId]
    );
  };

  const handleAddCondition = () => {
    if (!newCondition.value) {
      return;
    }

    const condition = {
      key: `status_change_${newCondition.value}_${Date.now()}`,
      trigger: 'status_change' as const,
      value: newCondition.value,
      template: newCondition.template,
    };

    setDraftConfig((current) =>
      getDefaultConfig({
        ...current,
        events: {
          ...(current?.events ?? {}),
          custom_conditions: [...(current?.events?.custom_conditions ?? []), condition],
        },
      })
    );
    setNewCondition({ value: '', template: '{{lead.name}} сменил статус на {{lead.status}}' });
    setShowConditionForm(false);
  };

  const handleSaveSettings = async () => {
    setIsSaving(true);
    setSaveMessage(null);

    const result = await saveExtensionSettings(params.agentId, {
      isActive: selectedExtension?.active ?? true,
      config: {
        recipients: draftRecipients,
        events: draftConfig?.events ?? {},
      },
    });

    if (result.error) {
      setSaveMessage(result.error);
      setIsSaving(false);
      return;
    }

    await refreshTelegramData();
    setSaveMessage('Сохранено');
    setIsSaving(false);
  };

  const connectedMembers = (telegramData?.members ?? []).filter((member) => Boolean(member.telegram_chat_id));
  const telegramCardClassName =
    'group flex h-full flex-col rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] p-6 text-left transition hover:border-[color:var(--color-ash)]';
  const telegramBadgeClassName =
    'inline-flex shrink-0 items-center rounded-full border border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--color-smoke)]';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.3em] text-[color:var(--color-smoke)]">Расширения</p>
          <h1 className="mt-2 text-3xl font-semibold text-[color:var(--color-chalk)]">Настройки поведения агента</h1>
          <p className="mt-2 max-w-2xl text-sm text-[color:var(--color-smoke)]">
            Агент {params.agentId} получает отдельные правила для Telegram, повторных касаний, пауз, очередей и разбивки ответов.
          </p>
        </div>

        <div className="rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] px-4 py-3">
          <div className="text-sm text-[color:var(--color-smoke)]">Активно</div>
          <div className="mt-1 text-2xl font-semibold text-[color:var(--color-chalk)]">
            {activeCount}/{extensions.length}
          </div>
        </div>
      </div>

      <div className="rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.3em] text-[color:var(--color-smoke)]">Kaspi Pay счета</p>
            <h2 className="mt-2 text-2xl font-semibold text-[color:var(--color-chalk)]">Отключён по умолчанию</h2>
            <p className="mt-2 max-w-2xl text-sm text-[color:var(--color-smoke)]">
              Инструмент createKaspiInvoice доступен только если ручной переключатель включен владельцем или администратором.
            </p>
          </div>

          <div className="flex flex-col items-start gap-3 sm:items-end">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-[color:var(--color-chalk)]">{kaspiInvoiceEnabled ? 'Включено' : 'Отключено'}</span>
              <button
                type="button"
                onClick={handleToggleKaspiInvoice}
                disabled={isSavingAgentSettings || isLoadingAgentSettings}
                className="rounded-full border border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] px-4 py-2 text-sm font-medium text-[color:var(--color-smoke)] transition hover:border-[color:var(--color-ash)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSavingAgentSettings ? 'Сохраняем…' : kaspiInvoiceEnabled ? 'Отключить' : 'Включить'}
              </button>
            </div>
            {agentSettingsError ? (
              <div className="text-sm text-rose-400">Не удалось загрузить настройки: {agentSettingsError.message}</div>
            ) : null}
            {agentSettingsSaveError ? (
              <div className="text-sm text-rose-400">{agentSettingsSaveError}</div>
            ) : null}
            <div className="text-sm text-[color:var(--color-smoke)]">
              Только роль owner/admin может менять этот флаг. Остальные пользователи увидят ошибку при попытке.
            </div>
          </div>
        </div>
      </div>

      <div className="grid auto-rows-fr gap-6 xl:grid-cols-2">
        {extensions.slice(0, 2).map((extension) => {
          const Icon = extension.icon;
          return (
            <button
              key={extension.key}
              type="button"
              onClick={() => setSelectedKey(extension.key)}
              className={telegramCardClassName}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 rounded-full border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] p-2 text-[color:var(--color-smoke)]">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div>
                    <div className="text-sm font-medium text-[color:var(--color-chalk)]">{extension.meta}</div>
                    <h2 className="mt-3 text-xl font-semibold text-[color:var(--color-chalk)]">{extension.title}</h2>
                  </div>
                </div>
                <span className={`${telegramBadgeClassName} ${extension.active ? 'bg-[color:var(--color-obsidian)] text-[color:var(--color-pulse-green)]' : 'bg-[color:var(--color-carbon)] text-[color:var(--color-smoke)]'}`}>
                  {extension.active ? 'Активно' : 'Отключено'}
                </span>
              </div>
              <p className="mt-4 text-sm leading-6 text-[color:var(--color-smoke)]">{extension.description}</p>
              <div className="mt-auto flex items-center justify-between pt-6 text-sm text-[color:var(--color-smoke)]">
                <span>Открыть настройки</span>
                <ChevronRight className="h-4 w-4 transition group-hover:translate-x-1" />
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid auto-rows-fr gap-6 md:grid-cols-2 2xl:grid-cols-3">
        {extensions.slice(2).map((extension) => {
          const Icon = extension.icon;
          return (
            <button
              key={extension.key}
              type="button"
              onClick={() => setSelectedKey(extension.key)}
              className="flex h-full flex-col rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] p-6 text-left transition hover:border-[color:var(--color-ash)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="rounded-full border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] p-2 text-[color:var(--color-smoke)]">
                  <Icon className="h-4 w-4" />
                </div>
                <span className={`${telegramBadgeClassName} ${extension.active ? 'bg-[color:var(--color-obsidian)] text-[color:var(--color-pulse-green)]' : 'bg-[color:var(--color-carbon)] text-[color:var(--color-smoke)]'}`}>
                  {extension.active ? 'Активно' : 'Отключено'}
                </span>
              </div>
              <h3 className="mt-4 text-lg font-semibold text-[color:var(--color-chalk)]">{extension.title}</h3>
              <p className="mt-2 text-sm leading-6 text-[color:var(--color-smoke)]">{extension.description}</p>
              <div className="mt-auto flex items-center pt-6 text-sm text-[color:var(--color-smoke)]">
                <span>Настроить</span>
                <ChevronRight className="ml-2 h-4 w-4" />
              </div>
            </button>
          );
        })}
      </div>

      {selectedExtension && (
        <div className="fixed inset-0 z-50 flex items-start justify-end bg-[color:var(--color-obsidian)]/80 p-4 sm:p-6">
          <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-[480px] flex-col overflow-hidden rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)]">
            <div className="flex flex-shrink-0 items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
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

            <div className="flex-1 overflow-y-auto px-6 py-6">
              {selectedExtension.key === 'telegram_notifications' ? (
                <div className="space-y-4">
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
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-white">Подключение аккаунтов команды</div>
                      <p className="mt-1 text-sm text-slate-400">Каждый сотрудник может подключить свой Telegram для алертов.</p>
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    {(telegramData?.members ?? []).map((member) => {
                      const connected = Boolean(member.telegram_chat_id);
                      const isLinking = linkBusyProfileId === member.id;
                      const isActiveLink = telegramLink?.profileId === member.id;

                      return (
                        <div key={member.id} className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="font-medium text-white">{member.full_name || 'Участник'}</div>
                              <div className="text-sm text-slate-400">{connected ? 'Подключено' : 'Ожидает подключения'}</div>
                            </div>
                            {connected ? (
                              <div className="flex items-center gap-2">
                                <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-3 py-1 text-sm text-emerald-300">
                                  <CheckCircle2 className="h-4 w-4" />
                                  Подключено
                                </span>
                                <button
                                  type="button"
                                  onClick={() => void handleDisconnectMember(member.id)}
                                  className="rounded-full border border-white/10 px-3 py-1 text-sm text-slate-300 transition hover:bg-white/10"
                                >
                                  Отключить
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void handleConnectMember(member.id)}
                                className="rounded-full bg-cyan-500 px-3 py-1.5 text-sm font-medium text-slate-950 transition hover:bg-cyan-400"
                                disabled={isLinking}
                              >
                                {isLinking ? 'Подключаем…' : 'Подключить'}
                              </button>
                            )}
                          </div>

                          {isActiveLink && telegramLink ? (
                            <div className="mt-3 rounded-xl border border-cyan-400/20 bg-cyan-500/10 p-3">
                              <div className="flex flex-wrap items-center gap-3">
                                <a
                                  href={telegramLink.link}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-2 rounded-full bg-cyan-500 px-3 py-2 text-sm font-medium text-slate-950 transition hover:bg-cyan-400"
                                >
                                  <ExternalLink className="h-4 w-4" />
                                  Открыть Telegram
                                </a>
                                <div className="flex items-center gap-2 text-sm text-cyan-200">
                                  <Clock3 className="h-4 w-4" />
                                  {countdownLabel}
                                </div>
                              </div>
                              <div className="mt-3 flex items-center gap-3">
                                <QRCodeSVG value={telegramLink.link} size={96} level="M" includeMargin />
                                <div className="text-sm text-slate-300">Откройте ссылку в Telegram, чтобы завершить подключение.</div>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>

                  {linkError ? <div className="mt-3 text-sm text-rose-400">{linkError}</div> : null}
                </div>

                <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                  <div className="text-sm font-medium text-white">Получатели уведомлений</div>
                  <p className="mt-1 text-sm text-slate-400">Выберите участников, которые будут получать алерты.</p>

                  <div className="mt-4 space-y-2">
                    {connectedMembers.length ? (
                      connectedMembers.map((member) => (
                        <label key={member.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-200">
                          <input
                            type="checkbox"
                            checked={draftRecipients.includes(member.id)}
                            onChange={() => handleToggleRecipient(member.id)}
                            className="h-4 w-4 rounded border-slate-600 bg-slate-900"
                          />
                          <span>{member.full_name || 'Участник'}</span>
                        </label>
                      ))
                    ) : (
                      <div className="text-sm text-slate-400">Подключённых участников пока нет.</div>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                  <div className="text-sm font-medium text-white">События для уведомлений</div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {/* Priority 1: operator_needed */}
                    <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1">
                          <div className="text-sm font-medium text-white">Лид просит оператора</div>
                          <div className="text-xs text-slate-400">Вызов redirectToOperator</div>
                        </div>
                        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                          <input
                            type="checkbox"
                            checked={draftConfig?.events?.operator_needed?.enabled ?? false}
                            onChange={() =>
                              setDraftConfig((current) =>
                                patchEventConfig(current, 'operator_needed', (values) => ({
                                  ...values,
                                  enabled: !((values.enabled as boolean | undefined) ?? false),
                                }))
                              )
                            }
                            className="h-4 w-4 rounded border-slate-600 bg-slate-900"
                          />
                        </label>
                      </div>
                    </div>

                    {/* Priority 2: deal_won */}
                    <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1">
                          <div className="text-sm font-medium text-white">Сделка закрыта 🎉</div>
                          <div className="text-xs text-slate-400">Статус = won</div>
                        </div>
                        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                          <input
                            type="checkbox"
                            checked={draftConfig?.events?.deal_won?.enabled ?? false}
                            onChange={() =>
                              setDraftConfig((current) =>
                                patchEventConfig(current, 'deal_won', (values) => ({
                                  ...values,
                                  enabled: !((values.enabled as boolean | undefined) ?? false),
                                }))
                              )
                            }
                            className="h-4 w-4 rounded border-slate-600 bg-slate-900"
                          />
                        </label>
                      </div>
                    </div>

                    {/* Priority 3: channel_down */}
                    <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1">
                          <div className="text-sm font-medium text-white">Канал недоступен</div>
                          <div className="text-xs text-slate-400">Ошибки вебхука</div>
                        </div>
                        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                          <input
                            type="checkbox"
                            checked={draftConfig?.events?.channel_down?.enabled ?? false}
                            onChange={() =>
                              setDraftConfig((current) =>
                                patchEventConfig(current, 'channel_down', (values) => ({
                                  ...values,
                                  enabled: !((values.enabled as boolean | undefined) ?? false),
                                }))
                              )
                            }
                            className="h-4 w-4 rounded border-slate-600 bg-slate-900"
                          />
                        </label>
                      </div>
                    </div>

                    {/* ai_silent with threshold */}
                    <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1">
                          <div className="text-sm font-medium text-white">AI не отвечает</div>
                          <div className="text-xs text-slate-400">Более N минут без ответа</div>
                        </div>
                        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                          <input
                            type="checkbox"
                            checked={draftConfig?.events?.ai_silent?.enabled ?? false}
                            onChange={() =>
                              setDraftConfig((current) =>
                                patchEventConfig(current, 'ai_silent', (values) => ({
                                  ...values,
                                  enabled: !((values.enabled as boolean | undefined) ?? false),
                                }))
                              )
                            }
                            className="h-4 w-4 rounded border-slate-600 bg-slate-900"
                          />
                        </label>
                      </div>
                      {draftConfig?.events?.ai_silent?.enabled ? (
                        <div className="mt-2 flex items-center gap-2">
                          <label className="flex-1 text-xs text-slate-300">
                            <span className="block mb-1">Порог (минут):</span>
                            <input
                              type="number"
                              min="1"
                              max="60"
                              value={draftConfig?.events?.ai_silent?.threshold_minutes ?? 5}
                              onChange={(e) =>
                                setDraftConfig((current) =>
                                  patchEventConfig(current, 'ai_silent', (values) => ({
                                    ...values,
                                    threshold_minutes: parseInt(e.target.value, 10) || 5,
                                  }))
                                )
                              }
                              className="w-full rounded-lg border border-white/10 bg-slate-900 px-2 py-1 text-slate-100"
                            />
                          </label>
                        </div>
                      ) : null}
                    </div>

                    {/* deal_lost */}
                    <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1">
                          <div className="text-sm font-medium text-white">Лид потерян</div>
                          <div className="text-xs text-slate-400">Статус = lost</div>
                        </div>
                        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                          <input
                            type="checkbox"
                            checked={draftConfig?.events?.deal_lost?.enabled ?? false}
                            onChange={() =>
                              setDraftConfig((current) =>
                                patchEventConfig(current, 'deal_lost', (values) => ({
                                  ...values,
                                  enabled: !((values.enabled as boolean | undefined) ?? false),
                                }))
                              )
                            }
                            className="h-4 w-4 rounded border-slate-600 bg-slate-900"
                          />
                        </label>
                      </div>
                    </div>

                    {/* new_lead */}
                    <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1">
                          <div className="text-sm font-medium text-white">Новый лид</div>
                          <div className="text-xs text-slate-400">Первое контактное сообщение</div>
                        </div>
                        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                          <input
                            type="checkbox"
                            checked={draftConfig?.events?.new_lead?.enabled ?? false}
                            onChange={() =>
                              setDraftConfig((current) =>
                                patchEventConfig(current, 'new_lead', (values) => ({
                                  ...values,
                                  enabled: !((values.enabled as boolean | undefined) ?? false),
                                }))
                              )
                            }
                            className="h-4 w-4 rounded border-slate-600 bg-slate-900"
                          />
                        </label>
                      </div>
                    </div>

                    {/* contact_received */}
                    <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1">
                          <div className="text-sm font-medium text-white">Лид оставил контакт</div>
                          <div className="text-xs text-slate-400">Телефон или email</div>
                        </div>
                        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                          <input
                            type="checkbox"
                            checked={draftConfig?.events?.contact_received?.enabled ?? false}
                            onChange={() =>
                              setDraftConfig((current) =>
                                patchEventConfig(current, 'contact_received', (values) => ({
                                  ...values,
                                  enabled: !((values.enabled as boolean | undefined) ?? false),
                                }))
                              )
                            }
                            className="h-4 w-4 rounded border-slate-600 bg-slate-900"
                          />
                        </label>
                      </div>
                    </div>

                    {/* repeat_touches_exhausted */}
                    <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1">
                          <div className="text-sm font-medium text-white">Повторные касания исчерпаны</div>
                          <div className="text-xs text-slate-400">Max attempts достигнут</div>
                        </div>
                        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                          <input
                            type="checkbox"
                            checked={draftConfig?.events?.repeat_touches_exhausted?.enabled ?? false}
                            onChange={() =>
                              setDraftConfig((current) =>
                                patchEventConfig(current, 'repeat_touches_exhausted', (values) => ({
                                  ...values,
                                  enabled: !((values.enabled as boolean | undefined) ?? false),
                                }))
                              )
                            }
                            className="h-4 w-4 rounded border-slate-600 bg-slate-900"
                          />
                        </label>
                      </div>
                    </div>

                    {/* lead_returned with silence_days */}
                    <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1">
                          <div className="text-sm font-medium text-white">Лид вернулся</div>
                          <div className="text-xs text-slate-400">После молчания &gt; N дней</div>
                        </div>
                        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                          <input
                            type="checkbox"
                            checked={draftConfig?.events?.lead_returned?.enabled ?? false}
                            onChange={() =>
                              setDraftConfig((current) =>
                                patchEventConfig(current, 'lead_returned', (values) => ({
                                  ...values,
                                  enabled: !((values.enabled as boolean | undefined) ?? false),
                                }))
                              )
                            }
                            className="h-4 w-4 rounded border-slate-600 bg-slate-900"
                          />
                        </label>
                      </div>
                      {draftConfig?.events?.lead_returned?.enabled ? (
                        <div className="mt-2 flex items-center gap-2">
                          <label className="flex-1 text-xs text-slate-300">
                            <span className="block mb-1">Дней молчания:</span>
                            <input
                              type="number"
                              min="1"
                              max="90"
                              value={draftConfig?.events?.lead_returned?.silence_days ?? 7}
                              onChange={(e) =>
                                setDraftConfig((current) =>
                                  patchEventConfig(current, 'lead_returned', (values) => ({
                                    ...values,
                                    silence_days: parseInt(e.target.value, 10) || 7,
                                  }))
                                )
                              }
                              className="w-full rounded-lg border border-white/10 bg-slate-900 px-2 py-1 text-slate-100"
                            />
                          </label>
                        </div>
                      ) : null}
                    </div>

                    {/* scheduled_failed */}
                    <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1">
                          <div className="text-sm font-medium text-white">Сообщение не доставлено</div>
                          <div className="text-xs text-slate-400">scheduled_messages failed</div>
                        </div>
                        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                          <input
                            type="checkbox"
                            checked={draftConfig?.events?.scheduled_failed?.enabled ?? false}
                            onChange={() =>
                              setDraftConfig((current) =>
                                patchEventConfig(current, 'scheduled_failed', (values) => ({
                                  ...values,
                                  enabled: !((values.enabled as boolean | undefined) ?? false),
                                }))
                              )
                            }
                            className="h-4 w-4 rounded border-slate-600 bg-slate-900"
                          />
                        </label>
                      </div>
                    </div>

                    {/* ai_error */}
                    <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1">
                          <div className="text-sm font-medium text-white">Ошибка AI (Gemini)</div>
                          <div className="text-xs text-slate-400">429 или 500 ошибки</div>
                        </div>
                        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                          <input
                            type="checkbox"
                            checked={draftConfig?.events?.ai_error?.enabled ?? false}
                            onChange={() =>
                              setDraftConfig((current) =>
                                patchEventConfig(current, 'ai_error', (values) => ({
                                  ...values,
                                  enabled: !((values.enabled as boolean | undefined) ?? false),
                                }))
                              )
                            }
                            className="h-4 w-4 rounded border-slate-600 bg-slate-900"
                          />
                        </label>
                      </div>
                    </div>

                    {/* worker_down */}
                    <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1">
                          <div className="text-sm font-medium text-white">Воркер завис</div>
                          <div className="text-xs text-slate-400">Нет обработки &gt;15 мин</div>
                        </div>
                        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                          <input
                            type="checkbox"
                            checked={draftConfig?.events?.worker_down?.enabled ?? false}
                            onChange={() =>
                              setDraftConfig((current) =>
                                patchEventConfig(current, 'worker_down', (values) => ({
                                  ...values,
                                  enabled: !((values.enabled as boolean | undefined) ?? false),
                                }))
                              )
                            }
                            className="h-4 w-4 rounded border-slate-600 bg-slate-900"
                          />
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* Custom conditions section */}
                  <div className="mt-4 rounded-xl border border-white/10 bg-slate-950/60 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-white">Кастомные условия</div>
                        <div className="text-sm text-slate-400">Уведомления по смене статуса лидов.</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowConditionForm(true)}
                        className="rounded-full border border-white/10 px-3 py-1.5 text-sm text-slate-300 transition hover:bg-white/10"
                      >
                        Добавить
                      </button>
                    </div>

                    <div className="mt-3 space-y-2">
                      {(draftConfig?.events?.custom_conditions ?? []).map((condition) => (
                        <div key={condition.key} className="rounded-lg border border-white/10 bg-slate-900/70 p-3">
                          <div className="text-sm font-medium text-white">{condition.value}</div>
                          <div className="mt-1 text-sm text-slate-400">{condition.template}</div>
                        </div>
                      ))}
                    </div>

                    {showConditionForm ? (
                      <div className="mt-3 space-y-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="text-sm text-slate-300">
                            <span className="mb-1 block">Событие</span>
                            <select className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-slate-100" defaultValue="status_change" disabled>
                              <option value="status_change">Смена статуса</option>
                            </select>
                          </label>
                          <label className="text-sm text-slate-300">
                            <span className="mb-1 block">Статус</span>
                            <select
                              className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-slate-100"
                              value={newCondition.value}
                              onChange={(event) => setNewCondition((current) => ({ ...current, value: event.target.value }))}
                            >
                              <option value="">Выберите статус</option>
                              {(telegramData?.statuses ?? []).map((status) => (
                                <option key={status} value={status}>
                                  {status}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>

                        <label className="block text-sm text-slate-300">
                          <span className="mb-1 block">Текст уведомления</span>
                          <textarea
                            className="min-h-[90px] w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-slate-100"
                            value={newCondition.template}
                            onChange={(event) => setNewCondition((current) => ({ ...current, template: event.target.value }))}
                          />
                          <span className="mt-1 block text-xs text-slate-500">Используйте переменные {'{{lead.name}}'} и {'{{lead.status}}'}</span>
                        </label>

                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setShowConditionForm(false)}
                            className="rounded-full border border-white/10 px-3 py-2 text-sm text-slate-300 transition hover:bg-white/10"
                          >
                            Отмена
                          </button>
                          <button
                            type="button"
                            onClick={handleAddCondition}
                            className="rounded-full bg-cyan-500 px-3 py-2 text-sm font-medium text-slate-950 transition hover:bg-cyan-400"
                          >
                            Добавить
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

                {saveMessage ? <div className="text-sm text-emerald-400">{saveMessage}</div> : null}

                <div className="flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setSelectedKey(null)}
                    className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10"
                  >
                    Закрыть
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSaveSettings()}
                    className="rounded-full bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-cyan-400"
                    disabled={isSaving}
                  >
                    {isSaving ? 'Сохраняем…' : 'Сохранить'}
                  </button>
                </div>
              </div>
            ) : (
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
            )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
