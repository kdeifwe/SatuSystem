'use client';

import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash, X } from 'lucide-react';
import { SalesNav } from '@/components/dashboard/sales-nav';

type Technique = {
  id: string;
  methodology: string;
  technique_name: string;
  niche_tags: string[];
  trigger_text: string;
  script_template: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  tokens_estimate: number;
  is_active: boolean | null;
};

const methodologies = ['SPIN', 'FAB', 'Challenger', 'Sandler', 'Objection Handling', 'Closing', 'Follow-up'];
const difficulties: Technique['difficulty'][] = ['beginner', 'intermediate', 'advanced'];

export default function SalesTechniquesPage() {
  const [techniques, setTechniques] = useState<Technique[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterMethodology, setFilterMethodology] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [mode, setMode] = useState<'create' | 'edit'>('create');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [methodology, setMethodology] = useState(methodologies[0]);
  const [techniqueName, setTechniqueName] = useState('');
  const [nicheTags, setNicheTags] = useState('');
  const [triggerText, setTriggerText] = useState('');
  const [scriptTemplate, setScriptTemplate] = useState('');
  const [difficulty, setDifficulty] = useState<Technique['difficulty']>('beginner');
  const [tokensEstimate, setTokensEstimate] = useState(80);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadTechniques = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/sales/techniques', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Не удалось загрузить техники');
      }
      setTechniques(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки техник');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTechniques();
  }, []);

  const openNewModal = () => {
    setMode('create');
    setActiveId(null);
    setMethodology(methodologies[0]);
    setTechniqueName('');
    setNicheTags('');
    setTriggerText('');
    setScriptTemplate('');
    setDifficulty('beginner');
    setTokensEstimate(80);
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (technique: Technique) => {
    setMode('edit');
    setActiveId(technique.id);
    setMethodology(technique.methodology);
    setTechniqueName(technique.technique_name);
    setNicheTags(technique.niche_tags.join(', '));
    setTriggerText(technique.trigger_text);
    setScriptTemplate(technique.script_template);
    setDifficulty(technique.difficulty);
    setTokensEstimate(technique.tokens_estimate ?? 80);
    setFormError(null);
    setIsModalOpen(true);
  };

  const closeModal = () => setIsModalOpen(false);

  const handleSubmit = async () => {
    setFormError(null);
    if (!techniqueName.trim() || !triggerText.trim() || !scriptTemplate.trim()) {
      setFormError('Заполните название, trigger text и шаблон');
      return;
    }

    const payload = {
      methodology,
      technique_name: techniqueName,
      niche_tags: nicheTags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      trigger_text: triggerText,
      script_template: scriptTemplate,
      difficulty,
      tokens_estimate: tokensEstimate,
    };

    if (payload.niche_tags.length === 0) {
      setFormError('Добавьте хотя бы один тег ниши');
      return;
    }

    setSaving(true);

    try {
      const response = await fetch(mode === 'create' ? '/api/sales/techniques' : `/api/sales/techniques/${activeId}`, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Не удалось сохранить технику');
      }
      closeModal();
      await loadTechniques();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Ошибка при сохранении');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Удалить технику?')) {
      return;
    }
    try {
      const response = await fetch(`/api/sales/techniques/${id}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Не удалось удалить технику');
      }
      await loadTechniques();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Ошибка удаления');
    }
  };

  const filteredTechniques = filterMethodology ? techniques.filter((item) => item.methodology === filterMethodology) : techniques;

  return (
    <main className="min-h-screen bg-[color:var(--color-obsidian)] px-4 py-8 text-[color:var(--color-chalk)] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <SalesNav />

        <section className="rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-2">
              <p className="text-sm uppercase tracking-[0.2em] text-[color:var(--color-smoke)]">ПРОДАЖИ</p>
              <h1 className="text-3xl font-normal tracking-[-0.03em] text-[color:var(--color-chalk)]">Техники</h1>
              <p className="max-w-2xl text-sm leading-6 text-[color:var(--color-smoke)]">
                Управляйте техниками, trigger-текстами и структурой.
              </p>
            </div>
            <button
              type="button"
              onClick={openNewModal}
              className="inline-flex items-center gap-2 rounded-full bg-[color:var(--color-signal-white)] px-6 py-3 text-sm uppercase tracking-[0.12em] text-[color:var(--color-obsidian)] transition hover:bg-[color:var(--color-chalk)]"
            >
              <Plus size={16} />
              Добавить технику
            </button>
          </div>

          <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <span className="text-sm uppercase tracking-[0.15em] text-[color:var(--color-smoke)]">Фильтр</span>
              <select
                value={filterMethodology}
                onChange={(event) => setFilterMethodology(event.target.value)}
                className="rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm text-[color:var(--color-chalk)] focus:border-[color:var(--color-chalk)] focus:outline-none"
              >
                <option value="">Все методологии</option>
                {methodologies.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0">
              <thead className="border-b border-[color:var(--color-graphite)]">
                <tr>
                  <th className="px-4 py-3 text-left text-xs uppercase tracking-[0.2em] text-[color:var(--color-smoke)]">Методология</th>
                  <th className="px-4 py-3 text-left text-xs uppercase tracking-[0.2em] text-[color:var(--color-smoke)]">Техника</th>
                  <th className="px-4 py-3 text-left text-xs uppercase tracking-[0.2em] text-[color:var(--color-smoke)]">Теги</th>
                  <th className="px-4 py-3 text-left text-xs uppercase tracking-[0.2em] text-[color:var(--color-smoke)]">Сложность</th>
                  <th className="px-4 py-3 text-left text-xs uppercase tracking-[0.2em] text-[color:var(--color-smoke)]">Токены</th>
                  <th className="px-4 py-3 text-right text-xs uppercase tracking-[0.2em] text-[color:var(--color-smoke)]">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[color:var(--color-graphite)]">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-sm text-[color:var(--color-smoke)]">Загрузка...</td>
                  </tr>
                ) : filteredTechniques.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-sm text-[color:var(--color-smoke)]">Техники не найдены.</td>
                  </tr>
                ) : (
                  filteredTechniques.map((technique) => (
                    <tr key={technique.id} className="hover:bg-[color:var(--color-obsidian)]">
                      <td className="px-4 py-4 text-sm text-[color:var(--color-chalk)]">{technique.methodology}</td>
                      <td className="px-4 py-4 text-sm text-[color:var(--color-chalk)]">{technique.technique_name}</td>
                      <td className="px-4 py-4 text-sm text-[color:var(--color-smoke)]">{technique.niche_tags.join(', ')}</td>
                      <td className="px-4 py-4 text-sm text-[color:var(--color-smoke)]">{technique.difficulty}</td>
                      <td className="px-4 py-4 text-sm text-[color:var(--color-smoke)]">{technique.tokens_estimate}</td>
                      <td className="px-4 py-4 text-right text-sm space-x-2">
                        <button
                          type="button"
                          onClick={() => openEditModal(technique)}
                          className="inline-flex items-center gap-2 rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] px-3 py-1.5 text-sm text-[color:var(--color-smoke)] transition hover:border-[color:var(--color-chalk)] hover:text-[color:var(--color-chalk)]"
                        >
                          <Pencil size={14} />
                          Ред.
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(technique.id)}
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
                <h2 className="text-xl font-semibold text-[color:var(--color-chalk)]">{mode === 'create' ? 'Создать технику' : 'Редактировать технику'}</h2>
                <p className="mt-1 text-sm text-[color:var(--color-smoke)]">Укажите название, теги, trigger text и шаблон.</p>
              </div>
              <button type="button" onClick={closeModal} className="rounded-full p-2 text-[color:var(--color-smoke)] transition hover:text-[color:var(--color-chalk)]">
                <X size={20} />
              </button>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="space-y-2 text-sm text-[color:var(--color-smoke)]">
                Методология
                <select
                  value={methodology}
                  onChange={(event) => setMethodology(event.target.value)}
                  className="w-full rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm text-[color:var(--color-chalk)] focus:border-[color:var(--color-chalk)] focus:outline-none"
                >
                  {methodologies.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2 text-sm text-[color:var(--color-smoke)]">
                Сложность
                <select
                  value={difficulty}
                  onChange={(event) => setDifficulty(event.target.value as Technique['difficulty'])}
                  className="w-full rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm text-[color:var(--color-chalk)] focus:border-[color:var(--color-chalk)] focus:outline-none"
                >
                  {difficulties.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="space-y-2 text-sm text-[color:var(--color-smoke)]">
                Название техники
                <input
                  value={techniqueName}
                  onChange={(event) => setTechniqueName(event.target.value)}
                  className="w-full rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm text-[color:var(--color-chalk)] focus:border-[color:var(--color-chalk)] focus:outline-none"
                />
              </label>
              <label className="space-y-2 text-sm text-[color:var(--color-smoke)]">
                Теги ниши
                <input
                  value={nicheTags}
                  onChange={(event) => setNicheTags(event.target.value)}
                  placeholder="example, upsell"
                  className="w-full rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm text-[color:var(--color-chalk)] focus:border-[color:var(--color-chalk)] focus:outline-none"
                />
              </label>
            </div>

            <div className="mt-4">
              <label className="text-sm text-[color:var(--color-smoke)]">Trigger text</label>
              <textarea
                value={triggerText}
                onChange={(event) => setTriggerText(event.target.value)}
                rows={3}
                className="mt-2 w-full rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm text-[color:var(--color-chalk)] focus:border-[color:var(--color-chalk)] focus:outline-none"
              />
            </div>

            <div className="mt-4">
              <label className="text-sm text-[color:var(--color-smoke)]">Script template</label>
              <textarea
                value={scriptTemplate}
                onChange={(event) => setScriptTemplate(event.target.value)}
                rows={4}
                className="mt-2 w-full rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm text-[color:var(--color-chalk)] focus:border-[color:var(--color-chalk)] focus:outline-none"
              />
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="space-y-2 text-sm text-[color:var(--color-smoke)]">
                Оценка токенов
                <input
                  type="number"
                  value={tokensEstimate}
                  onChange={(event) => setTokensEstimate(Number(event.target.value))}
                  className="w-full rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm text-[color:var(--color-chalk)] focus:border-[color:var(--color-chalk)] focus:outline-none"
                />
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
