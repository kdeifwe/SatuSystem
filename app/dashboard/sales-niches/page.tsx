'use client';

import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash, X } from 'lucide-react';
import { SalesNav } from '@/components/dashboard/sales-nav';

type Niche = {
  id: string;
  name: string;
  slug: string;
  traits: Record<string, unknown>;
  preferred_methodologies: string[];
  system_prompt_addon: string | null;
};

const methodologies = ['SPIN', 'FAB', 'Challenger', 'Sandler'];

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/--+/g, '-');
}

export default function SalesNichesPage() {
  const [niches, setNiches] = useState<Niche[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [mode, setMode] = useState<'create' | 'edit'>('create');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [traitsText, setTraitsText] = useState(`{
  "decision_type": "",
  "sales_cycle": "",
  "price_sensitivity": "",
  "buying_motivation": ""
}`);
  const [preferredMethodologies, setPreferredMethodologies] = useState<string[]>([]);
  const [systemPromptAddon, setSystemPromptAddon] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadNiches = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/sales/niches', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Не удалось загрузить ниши');
      }
      setNiches(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки ниш');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNiches();
  }, []);

  const openNewModal = () => {
    setMode('create');
    setActiveId(null);
    setName('');
    setSlug('');
    setSlugTouched(false);
    setTraitsText(`{
  "decision_type": "",
  "sales_cycle": "",
  "price_sensitivity": "",
  "buying_motivation": ""
}`);
    setPreferredMethodologies([]);
    setSystemPromptAddon('');
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (niche: Niche) => {
    setMode('edit');
    setActiveId(niche.id);
    setName(niche.name);
    setSlug(niche.slug);
    setSlugTouched(true);
    setTraitsText(JSON.stringify(niche.traits ?? {}, null, 2));
    setPreferredMethodologies(niche.preferred_methodologies ?? []);
    setSystemPromptAddon(niche.system_prompt_addon ?? '');
    setFormError(null);
    setIsModalOpen(true);
  };

  const closeModal = () => setIsModalOpen(false);

  const handleNameChange = (value: string) => {
    setName(value);
    if (!slugTouched) {
      setSlug(slugify(value));
    }
  };

  const handleSubmit = async () => {
    setFormError(null);
    if (!name.trim() || !slug.trim()) {
      setFormError('Название и slug обязательны');
      return;
    }

    let parsedTraits: Record<string, unknown> = {};
    try {
      parsedTraits = traitsText.trim() ? JSON.parse(traitsText) : {};
    } catch {
      setFormError('Traits должны быть валидным JSON');
      return;
    }

    if (preferredMethodologies.length === 0) {
      setFormError('Выберите минимум одну методологию');
      return;
    }

    setSaving(true);

    try {
      const payload = {
        name,
        slug,
        traits: parsedTraits,
        preferred_methodologies: preferredMethodologies,
        system_prompt_addon: systemPromptAddon || null,
      };

      const response = await fetch(mode === 'create' ? '/api/sales/niches' : `/api/sales/niches/${activeId}`, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Не удалось сохранить нишу');
      }
      closeModal();
      await loadNiches();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Ошибка при сохранении');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Удалить нишу?')) {
      return;
    }

    try {
      const response = await fetch(`/api/sales/niches/${id}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Не удалось удалить нишу');
      }
      await loadNiches();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Ошибка удаления');
    }
  };

  return (
    <main className="min-h-screen bg-[color:var(--color-obsidian)] px-4 py-8 text-[color:var(--color-chalk)] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <SalesNav />

        <section className="rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-2">
              <p className="text-sm uppercase tracking-[0.2em] text-[color:var(--color-smoke)]">ПРОДАЖИ</p>
              <h1 className="text-3xl font-normal tracking-[-0.03em] text-[color:var(--color-chalk)]">Ниши</h1>
              <p className="max-w-2xl text-sm leading-6 text-[color:var(--color-smoke)]">
                Управляйте нишами, предпочтительными методологиями и подсказками для агентов.
              </p>
            </div>
            <button
              type="button"
              onClick={openNewModal}
              className="inline-flex items-center gap-2 rounded-full bg-[color:var(--color-signal-white)] px-6 py-3 text-sm uppercase tracking-[0.12em] text-[color:var(--color-obsidian)] transition hover:bg-[color:var(--color-chalk)]"
            >
              <Plus size={16} />
              Создать нишу
            </button>
          </div>

          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0">
              <thead className="border-b border-[color:var(--color-graphite)]">
                <tr>
                  <th className="px-4 py-3 text-left text-xs uppercase tracking-[0.2em] text-[color:var(--color-smoke)]">Название</th>
                  <th className="px-4 py-3 text-left text-xs uppercase tracking-[0.2em] text-[color:var(--color-smoke)]">Slug</th>
                  <th className="px-4 py-3 text-left text-xs uppercase tracking-[0.2em] text-[color:var(--color-smoke)]">Методологии</th>
                  <th className="px-4 py-3 text-right text-xs uppercase tracking-[0.2em] text-[color:var(--color-smoke)]">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[color:var(--color-graphite)]">
                {loading ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-sm text-[color:var(--color-smoke)]">Загрузка...</td>
                  </tr>
                ) : niches.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-sm text-[color:var(--color-smoke)]">Ниши не найдены.</td>
                  </tr>
                ) : (
                  niches.map((niche) => (
                    <tr key={niche.id} className="hover:bg-[color:var(--color-obsidian)]">
                      <td className="px-4 py-4 text-sm text-[color:var(--color-chalk)]">{niche.name}</td>
                      <td className="px-4 py-4 text-sm text-[color:var(--color-smoke)]">{niche.slug}</td>
                      <td className="px-4 py-4 text-sm text-[color:var(--color-smoke)]">{niche.preferred_methodologies.join(', ')}</td>
                      <td className="px-4 py-4 text-right text-sm space-x-2">
                        <button
                          type="button"
                          onClick={() => openEditModal(niche)}
                          className="inline-flex items-center gap-2 rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] px-3 py-1.5 text-sm text-[color:var(--color-smoke)] transition hover:border-[color:var(--color-chalk)] hover:text-[color:var(--color-chalk)]"
                        >
                          <Pencil size={14} />
                          Ред.
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(niche.id)}
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
                <h2 className="text-xl font-semibold text-[color:var(--color-chalk)]">{mode === 'create' ? 'Создать нишу' : 'Редактировать нишу'}</h2>
                <p className="mt-1 text-sm text-[color:var(--color-smoke)]">Сохраните параметры ниши для агента.</p>
              </div>
              <button type="button" onClick={closeModal} className="rounded-full p-2 text-[color:var(--color-smoke)] transition hover:text-[color:var(--color-chalk)]">
                <X size={20} />
              </button>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="space-y-2 text-sm text-[color:var(--color-smoke)]">
                Название
                <input
                  value={name}
                  onChange={(event) => handleNameChange(event.target.value)}
                  className="w-full rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm text-[color:var(--color-chalk)] focus:border-[color:var(--color-chalk)] focus:outline-none"
                />
              </label>
              <label className="space-y-2 text-sm text-[color:var(--color-smoke)]">
                Slug
                <input
                  value={slug}
                  onChange={(event) => {
                    setSlug(event.target.value);
                    setSlugTouched(true);
                  }}
                  className="w-full rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm text-[color:var(--color-chalk)] focus:border-[color:var(--color-chalk)] focus:outline-none"
                />
              </label>
            </div>

            <div className="mt-4">
              <label className="text-sm text-[color:var(--color-smoke)]">Traits (JSON)</label>
              <textarea
                value={traitsText}
                onChange={(event) => setTraitsText(event.target.value)}
                rows={6}
                className="mt-2 w-full rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm text-[color:var(--color-chalk)] focus:border-[color:var(--color-chalk)] focus:outline-none"
              />
            </div>

            <div className="mt-4">
              <p className="text-sm text-[color:var(--color-smoke)]">Предпочитаемые методологии</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {methodologies.map((method) => (
                  <button
                    key={method}
                    type="button"
                    onClick={() =>
                      setPreferredMethodologies((current) =>
                        current.includes(method) ? current.filter((item) => item !== method) : [...current, method]
                      )
                    }
                    className={`rounded-[var(--radius-cards)] border px-3 py-2 text-left text-sm transition ${
                      preferredMethodologies.includes(method)
                        ? 'border-[color:var(--color-signal-white)] bg-[color:var(--color-signal-white)] text-[color:var(--color-obsidian)]'
                        : 'border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] text-[color:var(--color-smoke)] hover:border-[color:var(--color-chalk)] hover:text-[color:var(--color-chalk)]'
                    }`}
                  >
                    {method}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4">
              <label className="text-sm text-[color:var(--color-smoke)]">Дополнительная подсказка</label>
              <textarea
                value={systemPromptAddon}
                onChange={(event) => setSystemPromptAddon(event.target.value)}
                rows={4}
                className="mt-2 w-full rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm text-[color:var(--color-chalk)] focus:border-[color:var(--color-chalk)] focus:outline-none"
              />
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
