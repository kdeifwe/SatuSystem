'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, ChevronLeft, Trash2, Edit3 } from 'lucide-react';

const statuses = [
  'new',
  'contacted',
  'qualified',
  'proposal',
  'closed_won',
  'closed_lost',
];

const actionTypes = [
  { value: 'send_message', label: 'Отправить сообщение' },
  { value: 'ai_write', label: 'Написать через ИИ' },
  { value: 'change_status', label: 'Сменить этап' },
  { value: 'add_note', label: 'Добавить заметку' },
  { value: 'notify_operator', label: 'Уведомить оператора' },
] as const;

type ActionType = (typeof actionTypes)[number]['value'];

type ScenarioTrigger =
  | { type: 'status_enter'; status: string }
  | { type: 'no_reply_minutes'; minutes: number };

type ScenarioAction =
  | {
      type: 'send_message';
      text: string;
      use_whatsapp_template?: boolean;
      template_name?: string;
    }
  | { type: 'ai_write'; instruction: string }
  | { type: 'change_status'; status: string }
  | { type: 'add_note'; note: string }
  | { type: 'notify_operator'; message: string };

interface ScenarioItem {
  id: string;
  name: string;
  trigger: ScenarioTrigger;
  actions: ScenarioAction[];
  is_active: boolean;
  created_at: string;
}

interface RunItem {
  id: string;
  scenario_id: string;
  lead_id: string;
  result: string;
  ran_at: string;
  scenario: { name: string };
  lead: { name: string; attributes: Record<string, any> };
}

const initialAction = (): ScenarioAction => ({ type: 'send_message', text: '' });

export default function ScenariosPage({ params }: { params: { agentId: string } }) {
  const [activeTab, setActiveTab] = useState<'scenarios' | 'history'>('scenarios');
  const [scenarios, setScenarios] = useState<ScenarioItem[]>([]);
  const [runs, setRuns] = useState<RunItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingScenario, setEditingScenario] = useState<ScenarioItem | null>(null);
  const [filters, setFilters] = useState({ scenarioId: '', startDate: '', endDate: '' });
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [form, setForm] = useState({
    name: '',
    triggerType: 'status_enter',
    status: 'new',
    minutes: 60,
    actions: [initialAction()] as ScenarioAction[],
    is_active: true,
  });

  const scenarioId = params.agentId;

  useEffect(() => {
    loadScenarios();
    loadRuns();
  }, [scenarioId]);

  useEffect(() => {
    if (activeTab === 'history') {
      loadRuns();
    }
  }, [activeTab, filters, page]);

  async function loadScenarios() {
    setLoading(true);
    const res = await fetch(`/api/agents/${scenarioId}/scenarios`);
    const result = await res.json();
    if (!res.ok) {
      console.error(result.error);
    } else {
      setScenarios(result);
    }
    setLoading(false);
  }

  async function loadRuns() {
    setLoading(true);
    const params = new URLSearchParams();
    if (filters.scenarioId) params.set('scenarioId', filters.scenarioId);
    if (filters.startDate) params.set('startDate', filters.startDate);
    if (filters.endDate) params.set('endDate', filters.endDate);
    params.set('page', String(page));
    params.set('pageSize', '20');

    const res = await fetch(`/api/agents/${scenarioId}/scenario-runs?${params.toString()}`);
    const result = await res.json();
    if (!res.ok) {
      console.error(result.error);
    } else {
      setRuns(result.runs ?? []);
      setTotal(result.total ?? 0);
    }
    setLoading(false);
  }

  function openCreateForm() {
    setEditingScenario(null);
    setForm({
      name: '',
      triggerType: 'status_enter',
      status: 'new',
      minutes: 60,
      actions: [initialAction()],
      is_active: true,
    });
    setShowForm(true);
  }

  function openEditForm(scenario: ScenarioItem) {
    setEditingScenario(scenario);
    setForm({
      name: scenario.name,
      triggerType: scenario.trigger.type,
      status: scenario.trigger.type === 'status_enter' ? scenario.trigger.status : 'new',
      minutes: scenario.trigger.type === 'no_reply_minutes' ? scenario.trigger.minutes : 60,
      actions: scenario.actions,
      is_active: scenario.is_active,
    });
    setShowForm(true);
  }

  async function saveScenario() {
    const payload = {
      name: form.name,
      trigger:
        form.triggerType === 'status_enter'
          ? { type: 'status_enter', status: form.status }
          : { type: 'no_reply_minutes', minutes: Number(form.minutes) },
      actions: form.actions,
      is_active: form.is_active,
    };

    const url = editingScenario
      ? `/api/agents/${scenarioId}/scenarios/${editingScenario.id}`
      : `/api/agents/${scenarioId}/scenarios`;
    const method = editingScenario ? 'PATCH' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await res.json();
    if (!res.ok) {
      console.error(result.error);
      return;
    }

    setShowForm(false);
    await loadScenarios();
  }

  async function toggleScenario(scenario: ScenarioItem) {
    const res = await fetch(`/api/agents/${scenarioId}/scenarios/${scenario.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !scenario.is_active }),
    });
    if (res.ok) {
      await loadScenarios();
    }
  }

  async function deleteScenario(scenario: ScenarioItem) {
    if (!confirm('Удалить сценарий?')) return;
    const res = await fetch(`/api/agents/${scenarioId}/scenarios/${scenario.id}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      await loadScenarios();
    }
  }

  function addAction() {
    setForm((current) => ({ ...current, actions: [...current.actions, initialAction()] }));
  }

  function updateAction(index: number, action: ScenarioAction) {
    setForm((current) => ({
      ...current,
      actions: current.actions.map((item, idx) => (idx === index ? action : item)),
    }));
  }

  function removeAction(index: number) {
    setForm((current) => ({
      ...current,
      actions: current.actions.filter((_, idx) => idx !== index),
    }));
  }

  const triggerOptions = useMemo(
    () => [
      { value: 'status_enter', label: 'Лид вошёл в этап' },
      { value: 'no_reply_minutes', label: 'Нет ответа N минут/часов' },
    ],
    [],
  );

  const pageCount = Math.ceil(total / 20) || 1;

  return (
    <div className="hyper-dashboard-shell flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] px-6 py-4">
        <div>
          <h1 className="text-base font-semibold text-[color:var(--color-chalk)]">Сценарии</h1>
          <p className="text-xs text-[color:var(--color-smoke)]">Управление автоматическими сценариями и историей запусков</p>
        </div>
        <button
          type="button"
          onClick={openCreateForm}
          className="hyper-primary-btn inline-flex items-center gap-2 px-4 py-2 text-sm transition"
        >
          <Plus size={14} /> Создать сценарий
        </button>
      </div>

      <div className="flex gap-2 border-b border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] px-6 py-4">
        {['scenarios', 'history'].map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab as 'scenarios' | 'history')}
            className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ${activeTab === tab ? 'border-[color:var(--color-chalk)] bg-[color:var(--color-carbon)] text-[color:var(--color-chalk)]' : 'border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] text-[color:var(--color-smoke)] hover:border-[color:var(--color-ash)]'}`}
          >
            {tab === 'scenarios' ? 'Сценарии' : 'История запусков'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {activeTab === 'scenarios' ? (
          <div className="space-y-4">
            {loading ? (
              <div className="text-sm text-gray-500">Загрузка сценариев...</div>
            ) : scenarios.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-gray-200 p-8 text-center text-sm text-gray-500">
                Нет сценариев. Создайте первый сценарий, чтобы начать автоматизацию.
              </div>
            ) : (
              scenarios.map((scenario) => (
                <div key={scenario.id} className="rounded-3xl border border-gray-100 p-4 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{scenario.name || 'Без названия'}</p>
                      <p className="mt-1 text-xs text-gray-500">{formatTrigger(scenario.trigger)}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600">
                        {scenario.actions.length} действие{scenario.actions.length === 1 ? '' : 'й'}
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleScenario(scenario)}
                        className={`rounded-lg px-3 py-1 text-xs font-semibold ${scenario.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}
                      >
                        {scenario.is_active ? 'Включено' : 'Выключено'}
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-gray-500">
                    <button
                      type="button"
                      onClick={() => openEditForm(scenario)}
                      className="inline-flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-gray-700 hover:bg-gray-100"
                    >
                      <Edit3 size={14} /> Редактировать
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteScenario(scenario)}
                      className="inline-flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-red-600 hover:bg-red-100"
                    >
                      <Trash2 size={14} /> Удалить
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-4">
              <select
                value={filters.scenarioId}
                onChange={(event) => setFilters((current) => ({ ...current, scenarioId: event.target.value }))}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700"
              >
                <option value="">Все сценарии</option>
                {scenarios.map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>{scenario.name || scenario.id}</option>
                ))}
              </select>
              <input
                type="date"
                value={filters.startDate}
                onChange={(event) => setFilters((current) => ({ ...current, startDate: event.target.value }))}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700"
              />
              <input
                type="date"
                value={filters.endDate}
                onChange={(event) => setFilters((current) => ({ ...current, endDate: event.target.value }))}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700"
              />
              <button
                type="button"
                onClick={() => setPage(1)}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Применить
              </button>
            </div>

            <div className="overflow-x-auto rounded-3xl border border-gray-100">
              <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 font-semibold text-gray-500">Дата</th>
                    <th className="px-4 py-3 font-semibold text-gray-500">Сценарий</th>
                    <th className="px-4 py-3 font-semibold text-gray-500">Лид</th>
                    <th className="px-4 py-3 font-semibold text-gray-500">Результат</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {loading ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-gray-500">Загрузка...</td>
                    </tr>
                  ) : runs.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-gray-500">Нет запусков</td>
                    </tr>
                  ) : (
                    runs.map((run) => (
                      <tr key={run.id}>
                        <td className="px-4 py-4 text-gray-600">{new Date(run.ran_at).toLocaleString('ru-RU')}</td>
                        <td className="px-4 py-4 text-gray-900">{run.scenario?.name || 'Без названия'}</td>
                        <td className="px-4 py-4 text-gray-600">
                          {run.lead?.name || run.lead?.attributes?.phone || 'Лид'}
                        </td>
                        <td className="px-4 py-4 text-sm text-gray-700">{run.result}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between text-sm text-gray-500">
              <span>{`Показано ${runs.length} из ${total}`}</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                  className="rounded-lg border border-gray-200 px-3 py-1 text-gray-600 disabled:opacity-40"
                >
                  Назад
                </button>
                <button
                  type="button"
                  disabled={page >= pageCount}
                  onClick={() => setPage(page + 1)}
                  className="rounded-lg border border-gray-200 px-3 py-1 text-gray-600 disabled:opacity-40"
                >
                  Вперёд
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {showForm ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/30 px-4 py-6">
          <div className="mx-auto w-full max-w-3xl rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {editingScenario ? 'Редактировать сценарий' : 'Новый сценарий'}
                </h2>
                <p className="text-sm text-gray-500">Запускайте автоматические действия при смене этапа или отсутствии ответа.</p>
              </div>
              <button type="button" onClick={() => setShowForm(false)} className="text-gray-500 hover:text-gray-800">
                <ChevronLeft size={20} />
              </button>
            </div>

            <div className="mt-6 space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700">Название</label>
                <input
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700"
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Триггер</label>
                  <select
                    value={form.triggerType}
                    onChange={(event) => setForm((current) => ({ ...current, triggerType: event.target.value as 'status_enter' | 'no_reply_minutes' }))}
                    className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700"
                  >
                    {triggerOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                {form.triggerType === 'status_enter' ? (
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Этап</label>
                    <select
                      value={form.status}
                      onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
                      className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700"
                    >
                      {statuses.map((status) => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="grid gap-2">
                    <label className="block text-sm font-medium text-gray-700">Через</label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={form.minutes}
                        onChange={(event) => setForm((current) => ({ ...current, minutes: Number(event.target.value) }))}
                        className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700"
                      />
                      <span className="inline-flex items-center rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-600">минут</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-3xl border border-gray-100 bg-gray-50 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-900">Действия</h3>
                  <button
                    type="button"
                    onClick={addAction}
                    className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-100"
                  >
                    <Plus size={12} /> Добавить действие
                  </button>
                </div>
                <div className="mt-4 space-y-4">
                  {form.actions.map((action, index) => (
                    <div key={index} className="rounded-3xl border border-gray-200 bg-white p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <select
                          value={action.type}
                          onChange={(event) =>
                            updateAction(index, {
                              type: event.target.value as ActionType,
                              ...(event.target.value === 'send_message'
                                ? { text: '' }
                                : event.target.value === 'ai_write'
                                ? { instruction: '' }
                                : event.target.value === 'change_status'
                                ? { status: 'new' }
                                : event.target.value === 'add_note'
                                ? { note: '' }
                                : { message: '' }),
                            } as ScenarioAction)
                          }
                          className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700"
                        >
                          {actionTypes.map((typeOption) => (
                            <option key={typeOption.value} value={typeOption.value}>{typeOption.label}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => removeAction(index)}
                          className="rounded-full bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-100"
                        >
                          Удалить
                        </button>
                      </div>

                      <div className="mt-4 space-y-3">
                        {action.type === 'send_message' ? (
                          <div className="space-y-2">
                            <label className="block text-sm font-medium text-gray-700">Текст сообщения</label>
                            <textarea
                              value={(action as any).text}
                              onChange={(event) =>
                                updateAction(index, { ...(action as any), text: event.target.value })
                              }
                              rows={3}
                              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700"
                            />
                            <label className="flex items-center gap-2 text-sm text-gray-700">
                              <input
                                type="checkbox"
                                checked={Boolean((action as any).use_whatsapp_template)}
                                onChange={(event) =>
                                  updateAction(index, {
                                    ...(action as any),
                                    use_whatsapp_template: event.target.checked,
                                  })
                                }
                                className="h-4 w-4 rounded border-gray-300 text-blue-600"
                              />
                              Использовать WhatsApp-шаблон
                            </label>
                            {(action as any).use_whatsapp_template ? (
                              <input
                                value={(action as any).template_name ?? ''}
                                onChange={(event) =>
                                  updateAction(index, { ...(action as any), template_name: event.target.value })
                                }
                                placeholder="Имя шаблона WABA"
                                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700"
                              />
                            ) : null}
                          </div>
                        ) : action.type === 'ai_write' ? (
                          <div>
                            <label className="block text-sm font-medium text-gray-700">Инструкция для ИИ</label>
                            <textarea
                              value={(action as any).instruction}
                              onChange={(event) =>
                                updateAction(index, { ...(action as any), instruction: event.target.value })
                              }
                              rows={3}
                              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700"
                            />
                          </div>
                        ) : action.type === 'change_status' ? (
                          <div>
                            <label className="block text-sm font-medium text-gray-700">Новый этап</label>
                            <select
                              value={(action as any).status}
                              onChange={(event) =>
                                updateAction(index, { ...(action as any), status: event.target.value })
                              }
                              className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700"
                            >
                              {statuses.map((status) => (
                                <option key={status} value={status}>{status}</option>
                              ))}
                            </select>
                          </div>
                        ) : action.type === 'add_note' ? (
                          <div>
                            <label className="block text-sm font-medium text-gray-700">Текст заметки</label>
                            <textarea
                              value={(action as any).note}
                              onChange={(event) =>
                                updateAction(index, { ...(action as any), note: event.target.value })
                              }
                              rows={3}
                              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700"
                            />
                          </div>
                        ) : (
                          <div>
                            <label className="block text-sm font-medium text-gray-700">Уведомление оператору</label>
                            <textarea
                              value={(action as any).message}
                              onChange={(event) =>
                                updateAction(index, { ...(action as any), message: event.target.value })
                              }
                              rows={3}
                              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(event) => setForm((current) => ({ ...current, is_active: event.target.checked }))}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600"
                  />
                  Включен
                </label>
              </div>
            </div>

            <div className="mt-6 flex items-center gap-3">
              <button
                type="button"
                onClick={saveScenario}
                className="rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Сохранить
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-full border border-gray-200 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatTrigger(trigger: ScenarioTrigger) {
  if (trigger.type === 'status_enter') {
    return `Вход в этап ${trigger.status}`;
  }

  if (trigger.type === 'no_reply_minutes') {
    return `Нет ответа ${trigger.minutes} минут`;
  }

  return 'Триггер неизвестен';
}
