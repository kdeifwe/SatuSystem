'use client';

import { useEffect, useState } from 'react';

type Niche = {
  id: string;
  name: string;
  slug: string;
};

const methodologies = ['SPIN', 'FAB', 'Challenger', 'Sandler'];

type Props = {
  agentId: string;
};

export function AgentNicheAssignment({ agentId }: Props) {
  const [niches, setNiches] = useState<Niche[]>([]);
  const [selectedNicheId, setSelectedNicheId] = useState('');
  const [customMethodologies, setCustomMethodologies] = useState<string[]>([]);
  const [customPromptAddon, setCustomPromptAddon] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadNiches = async () => {
      try {
        const res = await fetch('/api/sales/niches');
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || 'Не удалось загрузить ниши');
        }
        setNiches(data ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Ошибка загрузки ниш');
      }
    };

    loadNiches();
  }, []);

  const toggleMethodology = (method: string) => {
    setCustomMethodologies((current) =>
      current.includes(method) ? current.filter((item) => item !== method) : [...current, method]
    );
  };

  const handleSubmit = async () => {
    if (!selectedNicheId) {
      setError('Выберите нишу продаж');
      setMessage(null);
      return;
    }

    setIsSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch('/api/sales/agent-niche', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: agentId,
          niche_id: selectedNicheId,
          custom_methodologies: customMethodologies,
          custom_prompt_addon: customPromptAddon || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Не удалось сохранить настройки ниши');
      }
      setMessage('Ниша продаж успешно привязана к агенту');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка при сохранении');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] p-6">
      <h2 className="text-lg font-normal tracking-[-0.03em] text-[color:var(--color-chalk)]">Ниша продаж</h2>
      <p className="mt-1 text-sm leading-6 text-[color:var(--color-smoke)]">
        Выберите нишу для агента и настройте дополнительные методологии.
      </p>

      <div className="mt-6 space-y-6">
        <div>
          <label className="text-sm uppercase tracking-[0.15em] text-[color:var(--color-smoke)]">Ниша</label>
          <select
            value={selectedNicheId}
            onChange={(event) => setSelectedNicheId(event.target.value)}
            className="mt-2 w-full rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm text-[color:var(--color-chalk)] focus:border-[color:var(--color-chalk)] focus:outline-none"
          >
            <option value="">Выберите нишу</option>
            {niches.map((niche) => (
              <option key={niche.id} value={niche.id}>
                {niche.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <p className="text-sm uppercase tracking-[0.15em] text-[color:var(--color-smoke)]">Переопределить методологии</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {methodologies.map((method) => (
              <button
                key={method}
                type="button"
                onClick={() => toggleMethodology(method)}
                className={`rounded-[var(--radius-cards)] border px-3 py-2 text-sm transition ${
                  customMethodologies.includes(method)
                    ? 'border-[color:var(--color-signal-white)] bg-[color:var(--color-signal-white)] text-[color:var(--color-obsidian)]'
                    : 'border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] text-[color:var(--color-smoke)] hover:border-[color:var(--color-chalk)] hover:text-[color:var(--color-chalk)]'
                }`}
              >
                {method}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-sm uppercase tracking-[0.15em] text-[color:var(--color-smoke)]">Дополнительная подсказка для ниши</label>
          <textarea
            value={customPromptAddon}
            onChange={(event) => setCustomPromptAddon(event.target.value)}
            rows={4}
            className="mt-2 w-full rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm text-[color:var(--color-chalk)] placeholder:text-[color:var(--color-smoke)] focus:border-[color:var(--color-chalk)] focus:outline-none"
          />
        </div>
      </div>

      {error ? <p className="mt-4 text-sm text-[color:var(--color-smoke)]">{error}</p> : null}
      {message ? <p className="mt-4 text-sm text-[color:var(--color-smoke)]">{message}</p> : null}

      <button
        disabled={isSaving}
        type="button"
        onClick={handleSubmit}
        className="mt-6 inline-flex items-center justify-center rounded-full bg-[color:var(--color-signal-white)] px-6 py-3 text-sm uppercase tracking-[0.12em] text-[color:var(--color-obsidian)] transition hover:bg-[color:var(--color-chalk)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSaving ? 'Сохраняю…' : 'Сохранить нишу'}
      </button>
    </div>
  );
}
