'use client';

import { useEffect, useState } from 'react';
import { Save, ToggleLeft, ToggleRight } from 'lucide-react';

export default function SettingsPage({ params }: { params: { agentId: string } }) {
  const [settings, setSettings] = useState({
    name: '',
    role: '',
    goal: '',
    tone_of_voice: '',
    temperature: 0.7,
    model: 'gemini-2.5-pro',
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
          temperature: data.temperature ?? 0.7,
          model: data.model ?? 'gemini-2.5-pro',
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
        temperature: settings.temperature,
        model: settings.model,
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
    setTimeout(() => setSaved(false), 2000);
  }

  function Toggle({
    value,
    onChange,
    label,
    description,
  }: {
    value: boolean;
    onChange: (value: boolean) => void;
    label: string;
    description: string;
  }) {
    return (
      <div className="flex items-center justify-between border-b border-gray-100 py-4 last:border-0">
        <div>
          <p className="text-sm font-medium text-gray-900">{label}</p>
          <p className="mt-0.5 text-xs text-gray-500">{description}</p>
        </div>
        <button
          type="button"
          onClick={() => onChange(!value)}
          className={`relative h-6 w-11 rounded-full transition-colors ${value ? 'bg-blue-600' : 'bg-gray-200'}`}
        >
          <span
            className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-5' : 'translate-x-0'}`}
          />
        </button>
      </div>
    );
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center text-gray-400">Загрузка...</div>;
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white px-6 py-4">
        <div>
          <h1 className="text-base font-semibold text-gray-900">Настройки агента</h1>
          <p className="text-xs text-gray-500">Управляйте поведением вашего ИИ-агента</p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          <Save size={14} />
          {saved ? '✓ Сохранено' : saving ? 'Сохраняю...' : 'Сохранить'}
        </button>
      </div>

      <div className="mx-auto w-full max-w-2xl space-y-8 px-6 py-6">
        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500">Основное</h2>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Имя агента</label>
              <input
                value={settings.name}
                onChange={(event) => setSettings((current) => ({ ...current, name: event.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Роль</label>
              <input
                value={settings.role}
                onChange={(event) => setSettings((current) => ({ ...current, role: event.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Цель</label>
              <textarea
                value={settings.goal}
                onChange={(event) => setSettings((current) => ({ ...current, goal: event.target.value }))}
                rows={2}
                className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Тон общения</label>
              <textarea
                value={settings.tone_of_voice}
                onChange={(event) => setSettings((current) => ({ ...current, tone_of_voice: event.target.value }))}
                rows={2}
                className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
              />
            </div>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500">Поведение в чате</h2>
          <div className="rounded-xl bg-gray-50 px-4">
            <Toggle
              value={settings.split_messages}
              onChange={(value) => setSettings((current) => ({ ...current, split_messages: value }))}
              label="Умное разделение сообщений"
              description="Агент разбивает длинный ответ на 2-3 коротких сообщения — как живой человек"
            />
            {settings.split_messages ? (
              <div className="border-b border-gray-100 py-4">
                <p className="mb-2 text-sm font-medium text-gray-900">Максимум сообщений за раз</p>
                <div className="flex gap-2">
                  {[1, 2, 3].map((part) => (
                    <button
                      key={part}
                      type="button"
                      onClick={() => setSettings((current) => ({ ...current, split_max_parts: part }))}
                      className={`h-10 w-10 rounded-lg text-sm font-medium transition-colors ${
                        settings.split_max_parts === part
                          ? 'bg-gray-900 text-white'
                          : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {part}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-gray-400">Рекомендуем: 2-3 для продаж, 1 для поддержки</p>
              </div>
            ) : null}
            <Toggle
              value={settings.typing_simulation}
              onChange={(value) => setSettings((current) => ({ ...current, typing_simulation: value }))}
              label="Имитация набора текста"
              description="Задержка перед каждым сообщением пропорциональна его длине (~40 символов/сек)"
            />
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500">Передача оператору</h2>
          <div className="rounded-xl bg-gray-50 p-4">
            <Toggle
              value={settings.handoff_enabled}
              onChange={(value) => setSettings((current) => ({ ...current, handoff_enabled: value }))}
              label="Включить авто-передачу"
              description="Когда триггер срабатывает, агент отключает AI и передаёт диалог оператору"
            />
            <div className="mt-4 grid gap-3 border-t border-gray-100 pt-4">
              {[
                { key: 'explicit_request', label: 'Клиент явно просит оператора' },
                { key: 'anger_complaint', label: 'Злость / жалоба / угроза' },
                { key: 'no_answer_after_two_searches', label: 'Агент не нашёл ответ 2 раза подряд' },
                { key: 'asks_if_bot', label: 'Клиент спрашивает «ты бот?»' },
              ].map((trigger) => (
                <label key={trigger.key} className="flex items-center gap-2 text-sm text-gray-700">
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
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>{trigger.label}</span>
                </label>
              ))}
            </div>
            <div className="mt-4 space-y-3 border-t border-gray-100 pt-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Сообщение клиенту при передаче</label>
                <textarea
                  value={settings.handoff_client_message}
                  onChange={(event) => setSettings((current) => ({ ...current, handoff_client_message: event.target.value }))}
                  rows={2}
                  className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Сообщение оператору</label>
                <textarea
                  value={settings.handoff_operator_message}
                  onChange={(event) => setSettings((current) => ({ ...current, handoff_operator_message: event.target.value }))}
                  rows={2}
                  className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                />
              </div>
            </div>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500">Продвинутые</h2>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Модель</label>
              <select
                value={settings.model}
                onChange={(event) => setSettings((current) => ({ ...current, model: event.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
              >
                <option value="gemini-2.5-pro">Gemini 2.5 Pro (умнее)</option>
                <option value="gemini-2.0-flash">Gemini 2.0 Flash (быстрее)</option>
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Температура: <span className="font-semibold text-blue-600">{settings.temperature}</span>
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={settings.temperature}
                onChange={(event) => setSettings((current) => ({ ...current, temperature: parseFloat(event.target.value) }))}
                className="w-full accent-blue-600"
              />
              <div className="mt-1 flex justify-between text-xs text-gray-400">
                <span>Точнее (0)</span>
                <span>Креативнее (1)</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
