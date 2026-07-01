'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { MoreHorizontal, ExternalLink, Settings, Trash2 } from 'lucide-react';
import { Card } from '../ui/card';
import { ConfirmDialog } from '../ui/confirm-dialog';

interface AgentCardProps {
  agent: {
    id: string;
    name: string;
    description: string | null;
    role?: string | null;
  };
  deleteAgent: (agentId: string) => Promise<{ error?: string }>;
}

export function AgentCard({ agent, deleteAgent }: AgentCardProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleCardClick = () => {
    router.push(`/dashboard/${agent.id}`);
  };

  const handleDelete = async () => {
    const result = await deleteAgent(agent.id);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setError(null);
    startTransition(() => {
      router.refresh();
    });
  };

  return (
    <Card className="overflow-hidden border border-slate-200 bg-white p-0 shadow-sm transition-shadow hover:shadow-md">
      <div className="relative h-40 bg-gradient-to-br from-slate-100 to-slate-200 p-4">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.8),transparent_45%)]" />
        <div className="absolute left-4 top-4 h-8 w-8 rounded-full bg-white/80" />
        <div className="absolute left-4 top-16 h-3 w-24 rounded-full bg-white/70" />
        <div className="absolute left-4 top-24 h-3 w-16 rounded-full bg-white/60" />
        <div className="absolute left-4 top-32 h-3 w-28 rounded-full bg-white/60" />

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setMenuOpen((value) => !value);
          }}
          className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50"
          aria-label="Открыть меню агента"
        >
          <MoreHorizontal size={18} />
        </button>

        {menuOpen ? (
          <div className="absolute right-4 top-16 z-10 w-48 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg">
            <button
              type="button"
              onClick={() => {
                router.push(`/dashboard/${agent.id}`);
                setMenuOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              <ExternalLink size={16} /> Открыть
            </button>
            <button
              type="button"
              onClick={() => {
                router.push(`/dashboard/${agent.id}`);
                setMenuOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              <Settings size={16} /> Настройки
            </button>
            <ConfirmDialog
              title={`Удалить агента «${agent.name}»?`}
              description="Это действие необратимо."
              confirmLabel="Удалить"
              onConfirm={handleDelete}
            >
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
              >
                <Trash2 size={16} /> Удалить
              </button>
            </ConfirmDialog>
          </div>
        ) : null}
      </div>

      <div className="cursor-pointer p-5" onClick={handleCardClick}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{agent.name}</h2>
            <p className="mt-1 text-sm text-slate-500">{agent.role || agent.description || 'Описание отсутствует.'}</p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${agent.description ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
            {agent.description ? 'Активен' : 'Черновик'}
          </span>
        </div>
      </div>

      {error ? <p className="px-5 pb-4 text-sm text-red-600">{error}</p> : null}
    </Card>
  );
}
