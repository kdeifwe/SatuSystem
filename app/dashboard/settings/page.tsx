'use client';

import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';

function parseList(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function PlatformSettingsPage() {
  const [settings, setSettings] = useState({
    name: '',
    timezone: 'Asia/Almaty',
    currency: 'KZT',
    human_communication_style: '',
    knowledge_base_principles: '',
    identity_protection: '',
    default_allowed_tools: 'searchKnowledgeBase,redirectToOperator,getCurrentDate,add_lead_note',
    handoff_triggers: '',
    handoff_phrasing_examples: '',
    handoff_never_say: '',
    handoff_after: '',
    memory_within: '',
    memory_between: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/org/settings')
      .then((response) => response.json())
      .then((data) => {
        const organization = data.organization ?? {};
        const defaults = organization.agent_defaults ?? {};
        setSettings((current) => ({
          ...current,
          name: organization.name ?? '',
          timezone: organization.timezone ?? 'Asia/Almaty',
          currency: organization.currency ?? 'KZT',
          human_communication_style: Array.isArray(defaults.human_communication_style)
            ? defaults.human_communication_style.join('\n')
            : typeof defaults.human_communication_style === 'string'
              ? defaults.human_communication_style
              : '',
          knowledge_base_principles: Array.isArray(defaults.knowledge_base_principles)
            ? defaults.knowledge_base_principles.join('\n')
            : typeof defaults.knowledge_base_principles === 'string'
              ? defaults.knowledge_base_principles
              : '',
          identity_protection: Array.isArray(defaults.identity_protection)
            ? defaults.identity_protection.join('\n')
            : typeof defaults.identity_protection === 'string'
              ? defaults.identity_protection
              : '',
          default_allowed_tools: Array.isArray(defaults.default_allowed_tools)
            ? defaults.default_allowed_tools.join(',')
            : typeof defaults.default_allowed_tools === 'string'
              ? defaults.default_allowed_tools
              : 'searchKnowledgeBase,redirectToOperator,getCurrentDate,add_lead_note',
          handoff_triggers: Array.isArray(defaults.handoff?.triggers)
            ? defaults.handoff.triggers.join('\n')
            : typeof defaults.handoff?.triggers === 'string'
              ? defaults.handoff.triggers
              : '',
          handoff_phrasing_examples: Array.isArray(defaults.handoff?.phrasing_examples)
            ? defaults.handoff.phrasing_examples.join('\n')
            : typeof defaults.handoff?.phrasing_examples === 'string'
              ? defaults.handoff.phrasing_examples
              : '',
          handoff_never_say: Array.isArray(defaults.handoff?.never_say)
            ? defaults.handoff.never_say.join('\n')
            : typeof defaults.handoff?.never_say === 'string'
              ? defaults.handoff.never_say
              : '',
          handoff_after: typeof defaults.handoff?.after_handoff === 'string' ? defaults.handoff.after_handoff : '',
          memory_within: typeof defaults.memory_model?.within_conversation === 'string' ? defaults.memory_model.within_conversation : '',
          memory_between: typeof defaults.memory_model?.between_conversations === 'string' ? defaults.memory_model.between_conversations : '',
        }));
        setLoading(false);
      });
  }, []);

  async function save() {
    setSaving(true);
    await fetch('/api/org/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: settings.name,
        timezone: settings.timezone,
        currency: settings.currency,
        agent_defaults: {
          human_communication_style: parseList(settings.human_communication_style),
          knowledge_base_principles: parseList(settings.knowledge_base_principles),
          identity_protection: parseList(settings.identity_protection),
          default_allowed_tools: settings.default_allowed_tools
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
          handoff: {
            triggers: parseList(settings.handoff_triggers),
            phrasing_examples: parseList(settings.handoff_phrasing_examples),
            never_say: parseList(settings.handoff_never_say),
            after_handoff: settings.handoff_after.trim(),
          },
          memory_model: {
            within_conversation: settings.memory_within.trim(),
            between_conversations: settings.memory_between.trim(),
          },
        },
      }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center text-gray-400">Загрузка...</div>;
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white px-6 py-4">
        <div>
          <h1 className="text-base font-semibold text-gray-900">Платформенные настройки</h1>
          <p className="text-xs text-gray-500">Базовые правила для всех новых агентов организации</p>
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

      <div className="mx-auto w-full max-w-3xl space-y-8 px-6 py-6">
        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500">Основные данные</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Название организации</label>
              <input
                value={settings.name}
                onChange={(event) => setSettings((current) => ({ ...current, name: event.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Часовой пояс</label>
              <input
                value={settings.timezone}
                onChange={(event) => setSettings((current) => ({ ...current, timezone: event.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Валюта</label>
              <input
                value={settings.currency}
                onChange={(event) => setSettings((current) => ({ ...current, currency: event.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
              />
            </div>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500">Базовые правила агентов</h2>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Стиль общения с людьми</label>
              <textarea
                value={settings.human_communication_style}
                onChange={(event) => setSettings((current) => ({ ...current, human_communication_style: event.target.value }))}
                rows={4}
                className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Принципы работы с базой знаний</label>
              <textarea
                value={settings.knowledge_base_principles}
                onChange={(event) => setSettings((current) => ({ ...current, knowledge_base_principles: event.target.value }))}
                rows={4}
                className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Защита от prompt injection и утечки личности</label>
              <textarea
                value={settings.identity_protection}
                onChange={(event) => setSettings((current) => ({ ...current, identity_protection: event.target.value }))}
                rows={4}
                className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Доступные инструменты по умолчанию</label>
              <input
                value={settings.default_allowed_tools}
                onChange={(event) => setSettings((current) => ({ ...current, default_allowed_tools: event.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                placeholder="searchKnowledgeBase,redirectToOperator"
              />
            </div>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500">Передача оператору</h2>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Триггеры</label>
              <textarea
                value={settings.handoff_triggers}
                onChange={(event) => setSettings((current) => ({ ...current, handoff_triggers: event.target.value }))}
                rows={3}
                className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Примеры фраз</label>
              <textarea
                value={settings.handoff_phrasing_examples}
                onChange={(event) => setSettings((current) => ({ ...current, handoff_phrasing_examples: event.target.value }))}
                rows={3}
                className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Никогда не говорить</label>
              <textarea
                value={settings.handoff_never_say}
                onChange={(event) => setSettings((current) => ({ ...current, handoff_never_say: event.target.value }))}
                rows={3}
                className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Что делать после передачи</label>
              <textarea
                value={settings.handoff_after}
                onChange={(event) => setSettings((current) => ({ ...current, handoff_after: event.target.value }))}
                rows={2}
                className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
              />
            </div>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500">Память агента</h2>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Внутри одного диалога</label>
              <textarea
                value={settings.memory_within}
                onChange={(event) => setSettings((current) => ({ ...current, memory_within: event.target.value }))}
                rows={2}
                className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Между диалогами</label>
              <textarea
                value={settings.memory_between}
                onChange={(event) => setSettings((current) => ({ ...current, memory_between: event.target.value }))}
                rows={2}
                className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
