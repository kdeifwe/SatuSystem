'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash, X } from 'lucide-react';
import { SalesNav } from '@/components/dashboard/sales-nav';

type Niche = {
  id: string;
  name: string;
  slug: string;
};

type Technique = {
  id: string;
  technique_name: string;
};

type ExampleRow = {
  id: string;
  niche_id: string;
  technique_id: string;
  situation_text: string;
  agent_reply: string;
  outcome: string;
  channel: string | null;
  niche_profiles: { name: string; slug: string } | null;
  sales_techniques: { technique_name: string } | null;
};

const outcomeOptions = [
  { value: 'lead_converted', label: 'Лид конвертирован' },
  { value: 'appointment_set', label: 'Назначена встреча' },
  { value: 'objection_handled', label: 'Возражение обработано' },
  { value: 'follow_up_scheduled', label: 'Follow-up запланирован' },
  { value: 'lost', label: 'Потерян' },
];
const channelOptions = ['whatsapp', 'telegram', 'instagram', 'web'];

export default function SalesExamplesPage() {
  const [examples, setExamples] = useState<ExampleRow[]>([]);
  const [niches, setNiches] = useState<Niche[]>([]);
  const [techniques, setTechniques] = useState<Technique[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [mode, setMode] = useState<'create' | 'edit'>('create');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [nicheId, setNicheId] = useState('');
  const [techniqueId, setTechniqueId] = useState('');
  const [situationText, setSituationText] = useState('');
  const [agentReply, setAgentReply] = useState('');
  const [outcome, setOutcome] = useState('lead_converted');
  const [channel, setChannel] = useState('whatsapp');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError(null);

    try {
      const [examplesRes, nichesRes, techniquesRes] = await Promise.all([
        fetch('/api/sales/examples', { cache: 'no-store' }),
        fetch('/api/sales/niches', { cache: 'no-store' }),
        fetch('/api/sales/techniques', { cache: 'no-store' }),
      ]);

      const examplesData = await examplesRes.json();
      const nichesData = await nichesRes.json();
      const techniquesData = await techniquesRes.json();

      if (!examplesRes.ok) throw new Error(examplesData?.error || 'Не удалось загрузить примеры');
      if (!nichesRes.ok) throw new Error(nichesData?.error || 'Не удалось загрузить ниши');
      if (!techniquesRes.ok) throw new Error(techniquesData?.error || 'Не удалось загрузить техники');

      setExamples(examplesData ?? []);
      setNiches(nichesData ?? []);
      setTechniques(techniquesData ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openNewModal = () => {
    setMode('create');
    setActiveId(null);
    setNicheId('');
    setTechniqueId('');
    setSituationText('');
    setAgentReply('');
    setOutcome('lead_converted');
    setChannel('whatsapp');
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (item: ExampleRow) => {
    setMode('edit');
    setActiveId(item.id);
    setNicheId(item.niche_id);
    setTechniqueId(item.technique_id);
    setSituationText(item.situation_text);
    setAgentReply(item.agent_reply);
    setOutcome(item.outcome);
    setChannel(item.channel || 'whatsapp');
    setFormError(null);
    setIsModalOpen(true);
  };

  const closeModal = () => setIsModalOpen(false);

  const handleSubmit = async () => {
    setFormError(null);
    if (!nicheId || !techniqueId || !situationText.trim() || !agentReply.trim()) {
      setFormError('Заполните все поля');
      return;
    }
    setSaving(true);

    try {
      const response = await fetch(mode === 'create' ? '/api/sales/examples' : `/api/sales/examples/${activeId}`, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          niche_id: nicheId,
          technique_id: techniqueId,
          situation_text: situationText,
          agent_reply: agentReply,
          outcome,
          channel,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Не удалось сохранить пример');
      }
      closeModal();
      await loadData();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Ошибка при сохранении');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Удалить пример?')) {
      return;
    }
    try {
      const response = await fetch(`/api/sales/examples/${id}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Не удалось удалить пример');
      }
      await loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Ошибка удаления');
    }
  };

  const techniqueNames = useMemo(() => {
    return techniques.reduce<Record<string, string>>((acc, technique) => {
      acc[technique.id] = technique.technique_name;
      return acc;
    }, {});
  }, [techniques]);

  return (
    <main className="min-h-screen bg-[color:var(--color-obsidian)] px-4 py-8 text-[color:var(--color-chalk)] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <SalesNav />

        <section className="rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-2">
              <p className="text-sm uppercase tracking-[0.2em] text-[color:var(--color-smoke)]">ПРОДАЖИ</p>
              <h1 className="text-3xl font-normal tracking-[-0.03em] text-[color:var(--color-chalk)]">Примеры</h1>
              <p className="max-w-2xl text-sm leading-6 text-[color:var(--color-smoke)]">
                Добавляйте примеры диалогов и результаты для обучения.
              </p>
            </div>
            <button
              type="button"
              onClick={openNewModal}
              className="inline-flex items-center gap-2 rounded-full bg-[color:var(--color-signal-white)] px-6 py-3 text-sm uppercase tracking-[0.12em] text-[color:var(--color-obsidian)] transition hover:bg-[color:var(--color-chalk)]"
            >
              <Plus size={16} />
              Новый пример
            </button>
          </div>

          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0">
              <thead className="border-b border-[color:var(--color-graphite)]">
                <tr>
                  <th className="px-4 py-3 text-left text-xs uppercase tracking-[0.2em] text-[color:var(--color-smoke)]">Ниша</th>
                  <th className="px-4 py-3 text-left text-xs uppercase tracking-[0.2em] text-[color:var(--color-smoke)]">Техника</th>
                  <th className="px-4 py-3 text-left text-xs uppercase tracking-[0.2em] text-[color:var(--color-smoke)]">Ситуация</th>
                  <th className="px-4 py-3 text-left text-xs uppercase tracking-[0.2em] text-[color:var(--color-smoke)]">Результат</th>
                  <th className="px-4 py-3 text-left text-xs uppercase tracking-[0.2em] text-[color:var(--color-smoke)]">Канал</th>
                  <th className="px-4 py-3 text-right text-xs uppercase tracking-[0.2em] text-[color:var(--color-smoke)]">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[color:var(--color-graphite)]">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-sm text-[color:var(--color-smoke)]">Загрузка...</td>
                  </tr>
                ) : examples.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-sm text-[color:var(--color-smoke)]">Примеры не найдены.</td>
                  </tr>
                ) : (
                  examples.map((item) => (
                    <tr key={item.id} className="hover:bg-[color:var(--color-obsidian)]">
                      <td className="px-4 py-4 text-sm text-[color:var(--color-chalk)]">{item.niche_profiles?.name || 'Не указано'}</td>
                      <td className="px-4 py-4 text-sm text-[color:var(--color-chalk)]">{item.sales_techniques?.technique_name || techniqueNames[item.technique_id] || 'Не указано'}</td>
                      <td className="px-4 py-4 text-sm text-[color:var(--color-smoke)]">
                        {item.situation_text.length > 80 ? `${item.situation_text.slice(0, 80)}...` : item.situation_text}
                      </td>
                      <td className="px-4 py-4 text-sm text-[color:var(--color-smoke)]">{outcomeOptions.find((option) => option.value === item.outcome)?.label ?? item.outcome}</td>
                      <td className="px-4 py-4 text-sm text-[color:var(--color-smoke)]">{item.channel || 'Не указан'}</td>
                      <td className="px-4 py-4 text-right text-sm space-x-2">
                        <button
                          type="button"
                          onClick={() => openEditModal(item)}
                          className="inline-flex items-center gap-2 rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] px-3 py-1.5 text-sm text-[color:var(--color-smoke)] transition hover:border-[color:var(--color-chalk)] hover:text-[color:var(--color-chalk)]"
                        >
                          <Pencil size={14} />
                          Ред.
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(item.id)}
                          className="inline-flex items-center gap-2 rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] px-3 py-1.5 text-sm text-[color:var(--color-smoke)] transition hover:border-[color:var(--color-chalk)] hover:text-[color:var(--color-chalk)]"
                        >
                          <Trash size={14} />
                          Удал.
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {isModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.55)] px-4 py-6">
          <div className="w-full max-w-3xl rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] p-6 shadow-lg">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-[color:var(--color-chalk)]">{mode === 'create' ? 'Новый пример' : 'Редактировать пример'}</h2>
                <p className="mt-1 text-sm text-[color:var(--color-smoke)]">Добавьте пример ситуации и ответ агента.</p>
              </div>
              <button type="button" onClick={closeModal} className="rounded-full p-2 text-[color:var(--color-smoke)] transition hover:text-[color:var(--color-chalk)]">
                <X size={20} />
              </button>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="space-y-2 text-sm text-[color:var(--color-smoke)]">
                Ниша
                <select
                  value={nicheId}
                  onChange={(event) => setNicheId(event.target.value)}
                  className="w-full rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm text-[color:var(--color-chalk)] focus:border-[color:var(--color-chalk)] focus:outline-none"
                >
                  <option value="">Выберите нишу</option>
                  {niches.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2 text-sm text-[color:var(--color-smoke)]">
                Техника
                <select
                  value={techniqueId}
                  onChange={(event) => setTechniqueId(event.target.value)}
                  className="w-full rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm text-[color:var(--color-chalk)] focus:border-[color:var(--color-chalk)] focus:outline-none"
                >
                  <option value="">Выберите технику</option>
                  {techniques.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.technique_name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-4">
              <label className="text-sm text-[color:var(--color-smoke)]">Ситуация</label>
              <textarea
                value={situationText}
                onChange={(event) => setSituationText(event.target.value)}
                rows={3}
                className="mt-2 w-full rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm text-[color:var(--color-chalk)] focus:border-[color:var(--color-chalk)] focus:outline-none"
              />
            </div>

            <div className="mt-4">
              <label className="text-sm text-[color:var(--color-smoke)]">Ответ агента</label>
              <textarea
                value={agentReply}
                onChange={(event) => setAgentReply(event.target.value)}
                rows={3}
                className="mt-2 w-full rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm text-[color:var(--color-chalk)] focus:border-[color:var(--color-chalk)] focus:outline-none"
              />
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="space-y-2 text-sm text-[color:var(--color-smoke)]">
                Исход
                <select
                  value={outcome}
                  onChange={(event) => setOutcome(event.target.value)}
                  className="w-full rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm text-[color:var(--color-chalk)] focus:border-[color:var(--color-chalk)] focus:outline-none"
                >
                  {outcomeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2 text-sm text-[color:var(--color-smoke)]">
                Канал
                <select
                  value={channel}
                  onChange={(event) => setChannel(event.target.value)}
                  className="w-full rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm text-[color:var(--color-chalk)] focus:border-[color:var(--color-chalk)] focus:outline-none"
                >
                  {channelOptions.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {formError ? <p className="mt-4 text-sm text-[color:var(--color-smoke)]">{formError}</p> : null}

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeModal}
                className="rounded-full border border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] px-5 py-2.5 text-sm text-[color:var(--color-smoke)] transition hover:border-[color:var(--color-chalk)] hover:text-[color:var(--color-chalk)]"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={saving}
                className="inline-flex items-center justify-center rounded-full bg-[color:var(--color-signal-white)] px-5 py-2.5 text-sm uppercase tracking-[0.12em] text-[color:var(--color-obsidian)] transition hover:bg-[color:var(--color-chalk)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? 'Сохраняю…' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
