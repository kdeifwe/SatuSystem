'use client';

import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

const DEFAULT_AGENT_MODEL = 'gemini-2.5-flash';
const ALLOWED_AGENT_MODELS = new Set(['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-2.0-flash']);

function isAllowedAgentModel(model: unknown): model is string {
  return typeof model === 'string' && ALLOWED_AGENT_MODELS.has(model);
}

function normalizeAgentModel(model: unknown): string {
  return isAllowedAgentModel(model) ? model : DEFAULT_AGENT_MODEL;
}

const modelGroups: Array<{
  key: string;
  label: string;
  description: string;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
}> = [
  {
    key: 'text',
    label: 'Текст / диалог',
    description: 'Текстовые модели — для диалогов с клиентами в чате',
    options: [
      { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash — быстрый, доступный, для большинства диалогов' },
      { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite — дешёвый вариант для FAQ' },
      { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro — мощный вариант для сложных задач' },
      { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash — совместимый fallback' },
    ],
  },
  {
    key: 'images',
    label: 'Генерация изображений',
    description: 'Изображения — агент сможет присылать сгенерированные визуалы',
    options: [{ value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash — доступна для текстовых сценариев' }],
  },
  {
    key: 'video',
    label: 'Генерация видео',
    description: 'Видео — для будущих модулей рекламных роликов',
    options: [{ value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash — текстовые сценарии без видео', disabled: true }],
  },
  {
    key: 'voice',
    label: 'Голос',
    description: 'Голос — для звонков через модуль Голосовой агент',
    options: [{ value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash — пока не используется для голосовых сценариев', disabled: true }],
  },
  {
    key: 'legacy',
    label: 'Устаревшие / legacy',
    description: 'Устаревшие варианты — для уже существующих агентов, которые ещё используют их',
    options: [
      { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash — legacy, для уже существующих агентов' },
      { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite — legacy, для уже существующих агентов' },
      { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro — legacy, для уже существующих агентов' },
      { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash — совместимый fallback', disabled: false },
    ],
  },
];

export default function SettingsPage({ params }: { params: { agentId: string } }) {
  const [settings, setSettings] = useState({
    name: '',
    role: '',
    goal: '',
    tone_of_voice: '',
    communication_rules: '',
    human_communication_style: '',
    knowledge_base_principles: '',
    temperature: 0.7,
    model: DEFAULT_AGENT_MODEL,
    split_messages: true,
    split_max_parts: 3,
    typing_simulation: true,
    handoff_enabled: true,
    handoff_triggers: {
      explicit_request: true,
      anger_complaint: true,
      no_answer_after_two_searches: true,
      asks_if_bot: false,
    },
    handoff_client_message: 'Подключаю сотрудника, он уже видит наш диалог',
    handoff_operator_message: 'Новый диалог требует внимания',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch(`/api/agents/${params.agentId}/settings`)
      .then((response) => response.json())
      .then((data) => {
        const capabilities = data.general_capabilities ?? {};
        setSettings((current) => ({
          ...current,
          name: data.name ?? '',
          role: data.role ?? '',
          goal: data.goal ?? '',
          tone_of_voice: data.tone_of_voice ?? '',
          communication_rules: data.communication_rules ?? '',
          human_communication_style: data.human_communication_style ?? '',
          knowledge_base_principles: data.knowledge_base_principles ?? '',
          temperature: data.temperature ?? 0.7,
          model: normalizeAgentModel(data.model),
          split_messages: capabilities.split_messages ?? true,
          split_max_parts: capabilities.split_max_parts ?? 3,
          typing_simulation: capabilities.typing_simulation ?? true,
          handoff_enabled: capabilities.handoff_config?.enabled ?? true,
          handoff_triggers: {
            explicit_request: capabilities.handoff_config?.triggers?.explicit_request ?? true,
            anger_complaint: capabilities.handoff_config?.triggers?.anger_complaint ?? true,
            no_answer_after_two_searches: capabilities.handoff_config?.triggers?.no_answer_after_two_searches ?? true,
            asks_if_bot: capabilities.handoff_config?.triggers?.asks_if_bot ?? false,
          },
          handoff_client_message: capabilities.handoff_config?.client_message ?? 'Подключаю сотрудника, он уже видит наш диалог',
          handoff_operator_message: capabilities.handoff_config?.operator_message ?? 'Новый диалог требует внимания',
        }));
        setLoading(false);
      });
  }, [params.agentId]);

  async function save() {
    setSaving(true);
    await fetch(`/api/agents/${params.agentId}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: settings.name,
        role: settings.role,
        goal: settings.goal,
        tone_of_voice: settings.tone_of_voice,
        communication_rules: settings.communication_rules,
        human_communication_style: settings.human_communication_style,
        knowledge_base_principles: settings.knowledge_base_principles,
        temperature: settings.temperature,
        model: normalizeAgentModel(settings.model),
        general_capabilities: {
          split_messages: settings.split_messages,
          split_max_parts: settings.split_max_parts,
          typing_simulation: settings.typing_simulation,
          handoff_config: {
            enabled: settings.handoff_enabled,
            triggers: settings.handoff_triggers,
            client_message: settings.handoff_client_message,
            operator_message: settings.handoff_operator_message,
          },
        },
      }),
    });
    setSaving(false);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  }

  function Toggle({ value, onChange, label, description }: { value: boolean; onChange: (value: boolean) => void; label: string; description: string }) {
    return (
      <div className="flex items-center justify-between border-b border-[color:var(--color-graphite)] py-4 last:border-0">
        <div>
          <p className="text-sm font-medium text-[color:var(--color-chalk)]">{label}</p>
          <p className="mt-0.5 text-xs text-[color:var(--color-smoke)]">{description}</p>
        </div>
        <button
          type="button"
          onClick={() => onChange(!value)}
          className={`relative h-6 w-11 rounded-full transition-colors ${value ? 'bg-[color:var(--color-pulse-green)]' : 'bg-[color:var(--color-graphite)]'}`}
        >
          <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-[color:var(--color-chalk)] shadow transition-transform ${value ? 'translate-x-5' : 'translate-x-0'}`} />
        </button>
      </div>
    );
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center text-[color:var(--color-smoke)]">Загрузка...</div>;
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[color:var(--color-obsidian)] text-[color:var(--color-chalk)]">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] px-6 py-4">
        <div>
          <h1 className="text-base font-semibold text-[color:var(--color-chalk)]">Настройки агента</h1>
          <p className="text-xs text-[color:var(--color-smoke)]">Управляйте поведением вашего ИИ-агента</p>
        </div>
        <Button type="button" variant="primary" onClick={save} disabled={saving} className="px-4 py-2">
          <Save size={14} />
          {saved ? '✓ Сохранено' : saving ? 'Сохраняю...' : 'Сохранить'}
        </Button>
      </div>

      <div className="mx-auto w-full max-w-2xl space-y-8 px-6 py-6">
        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[color:var(--color-smoke)]">Основное</h2>
          <Card className="space-y-4 border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] p-6">
            <div>
              <label className="mb-1 block text-sm font-medium text-[color:var(--color-smoke)]">Имя агента</label>
              <input
                value={settings.name}
                onChange={(event) => setSettings((current) => ({ ...current, name: event.target.value }))}
                className="w-full rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm text-[color:var(--color-chalk)] focus:border-[color:var(--color-ash)] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[color:var(--color-smoke)]">Роль</label>
              <input
                value={settings.role}
                onChange={(event) => setSettings((current) => ({ ...current, role: event.target.value }))}
                className="w-full rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm text-[color:var(--color-chalk)] focus:border-[color:var(--color-ash)] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[color:var(--color-smoke)]">Цель</label>
              <textarea
                value={settings.goal}
                onChange={(event) => setSettings((current) => ({ ...current, goal: event.target.value }))}
                rows={2}
                className="w-full resize-none rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm text-[color:var(--color-chalk)] focus:border-[color:var(--color-ash)] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[color:var(--color-smoke)]">Тон общения</label>
              <textarea
                value={settings.tone_of_voice}
                onChange={(event) => setSettings((current) => ({ ...current, tone_of_voice: event.target.value }))}
                rows={2}
                className="w-full resize-none rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm text-[color:var(--color-chalk)] focus:border-[color:var(--color-ash)] focus:outline-none"
              />
            </div>
          </Card>
        </section>

        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[color:var(--color-smoke)]">Коммуникация и правила</h2>
          <Card className="space-y-4 border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] p-6">
            <div>
              <label className="mb-1 block text-sm font-medium text-[color:var(--color-smoke)]">Правила общения</label>
              <textarea
                value={settings.communication_rules}
                onChange={(event) => setSettings((current) => ({ ...current, communication_rules: event.target.value }))}
                rows={3}
                className="w-full resize-none rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm text-[color:var(--color-chalk)] focus:border-[color:var(--color-ash)] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[color:var(--color-smoke)]">Стиль общения с людьми</label>
              <textarea
                value={settings.human_communication_style}
                onChange={(event) => setSettings((current) => ({ ...current, human_communication_style: event.target.value }))}
                rows={3}
                className="w-full resize-none rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm text-[color:var(--color-chalk)] focus:border-[color:var(--color-ash)] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[color:var(--color-smoke)]">Принципы работы с базой знаний</label>
              <textarea
                value={settings.knowledge_base_principles}
                onChange={(event) => setSettings((current) => ({ ...current, knowledge_base_principles: event.target.value }))}
                rows={3}
                className="w-full resize-none rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm text-[color:var(--color-chalk)] focus:border-[color:var(--color-ash)] focus:outline-none"
              />
            </div>
          </Card>
        </section>

        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[color:var(--color-smoke)]">Поведение в чате</h2>
          <Card className="border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] p-4">
            <Toggle
              value={settings.split_messages}
              onChange={(value) => setSettings((current) => ({ ...current, split_messages: value }))}
              label="Умное разделение сообщений"
              description="Агент разбивает длинный ответ на 2-3 коротких сообщения — как живой человек"
            />
            {settings.split_messages ? (
              <div className="border-b border-[color:var(--color-graphite)] py-4">
                <p className="mb-2 text-sm font-medium text-[color:var(--color-chalk)]">Максимум сообщений за раз</p>
                <div className="flex gap-2">
                  {[1, 2, 3].map((part) => (
                    <button
                      key={part}
                      type="button"
                      onClick={() => setSettings((current) => ({ ...current, split_max_parts: part }))}
                      className={`h-10 w-10 rounded-[var(--radius-cards)] text-sm font-medium transition-colors ${
                        settings.split_max_parts === part
                          ? 'bg-[color:var(--color-signal-white)] text-[color:var(--color-obsidian)]'
                          : 'border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] text-[color:var(--color-chalk)] hover:border-[color:var(--color-ash)]'
                      }`}
                    >
                      {part}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-[color:var(--color-smoke)]">Рекомендуем: 2-3 для продаж, 1 для поддержки</p>
              </div>
            ) : null}
            <Toggle
              value={settings.typing_simulation}
              onChange={(value) => setSettings((current) => ({ ...current, typing_simulation: value }))}
              label="Имитация набора текста"
              description="Задержка перед каждым сообщением пропорциональна его длине (~40 символов/сек)"
            />
          </Card>
        </section>

        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[color:var(--color-smoke)]">Передача оператору</h2>
          <Card className="space-y-4 border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] p-6">
            <Toggle
              value={settings.handoff_enabled}
              onChange={(value) => setSettings((current) => ({ ...current, handoff_enabled: value }))}
              label="Включить авто-передачу"
              description="Когда триггер срабатывает, агент отключает AI и передаёт диалог оператору"
            />
            <div className="mt-4 grid gap-3 border-t border-[color:var(--color-graphite)] pt-4">
              {[
                { key: 'explicit_request', label: 'Клиент явно просит оператора' },
                { key: 'anger_complaint', label: 'Злость / жалоба / угроза' },
                { key: 'no_answer_after_two_searches', label: 'Агент не нашёл ответ 2 раза подряд' },
                { key: 'asks_if_bot', label: 'Клиент спрашивает «ты бот?»' },
              ].map((trigger) => (
                <label key={trigger.key} className="flex items-center gap-2 text-sm text-[color:var(--color-smoke)]">
                  <input
                    type="checkbox"
                    checked={settings.handoff_triggers[trigger.key as keyof typeof settings.handoff_triggers]}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        handoff_triggers: {
                          ...current.handoff_triggers,
                          [trigger.key]: event.target.checked,
                        },
                      }))
                    }
                    className="h-4 w-4 rounded border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] text-[color:var(--color-pulse-green)] focus:ring-0"
                  />
                  <span>{trigger.label}</span>
                </label>
              ))}
            </div>
            <div className="mt-4 space-y-3 border-t border-[color:var(--color-graphite)] pt-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-[color:var(--color-smoke)]">Сообщение клиенту при передаче</label>
                <textarea
                  value={settings.handoff_client_message}
                  onChange={(event) => setSettings((current) => ({ ...current, handoff_client_message: event.target.value }))}
                  rows={2}
                  className="w-full resize-none rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm text-[color:var(--color-chalk)] focus:border-[color:var(--color-ash)] focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-[color:var(--color-smoke)]">Сообщение оператору</label>
                <textarea
                  value={settings.handoff_operator_message}
                  onChange={(event) => setSettings((current) => ({ ...current, handoff_operator_message: event.target.value }))}
                  rows={2}
                  className="w-full resize-none rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm text-[color:var(--color-chalk)] focus:border-[color:var(--color-ash)] focus:outline-none"
                />
              </div>
            </div>
          </Card>
        </section>

        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[color:var(--color-smoke)]">Продвинутые</h2>
          <Card className="space-y-4 border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] p-6">
            <div>
              <label className="mb-1 block text-sm font-medium text-[color:var(--color-smoke)]">Модель</label>
              <select
                value={settings.model}
                onChange={(event) => setSettings((current) => ({ ...current, model: event.target.value }))}
                className="w-full rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm text-[color:var(--color-chalk)] focus:border-[color:var(--color-ash)] focus:outline-none"
              >
                {modelGroups.map((group) => (
                  <optgroup key={group.key} label={group.label}>
                    {group.options.map((option) => (
                      <option key={option.value} value={option.value} disabled={option.disabled}>
                        {option.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <div className="mt-2 space-y-1">
                {modelGroups.map((group) => (
                  <p key={group.key} className="text-xs text-[color:var(--color-smoke)]">
                    {group.description}
                  </p>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-[color:var(--color-smoke)]">
                Температура: <span className="font-semibold text-[color:var(--color-chalk)]">{settings.temperature}</span>
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={settings.temperature}
                onChange={(event) => setSettings((current) => ({ ...current, temperature: parseFloat(event.target.value) }))}
                className="w-full accent-[color:var(--color-pulse-green)]"
              />
              <div className="mt-1 flex justify-between text-xs text-[color:var(--color-smoke)]">
                <span>Точнее (0)</span>
                <span>Креативнее (1)</span>
              </div>
            </div>
          </Card>
        </section>
      </div>
    </div>
  );
}
