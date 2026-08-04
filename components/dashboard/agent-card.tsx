'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { MoreHorizontal, ExternalLink, Settings, Trash2 } from 'lucide-react';
import { Avatar } from '../ui/avatar';
import AgentIcon from '../ui/agent-icon';
import { Badge } from '../ui/badge';
import { Card } from '../ui/card';
import { ConfirmDialog } from '../ui/confirm-dialog';
import DotMapGraphic from '../dot-map-graphic';

interface AgentCardProps {
  agent: {
    id: string;
    name: string;
    description: string | null;
    role?: string | null;
  };
  canDelete?: boolean;
}

export function AgentCard({ agent, canDelete = false }: AgentCardProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [, startTransition] = useTransition();

  const handleCardClick = () => {
    router.push(`/dashboard/${agent.id}`);
  };

  const handleDelete = async () => {
    try {
      const response = await fetch(`/api/agents/${agent.id}`, {
        method: 'DELETE',
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        throw new Error(data?.error || 'Не удалось удалить агента');
      }

      setError(null);
      setMenuOpen(false);
      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось удалить агента');
    }
  };

  const parsedVariant = Number.parseInt(agent.id.replace(/[^\d]/g, ''), 10);
  const patternVariant = Number.isNaN(parsedVariant) ? 0 : parsedVariant % 3;

  return (
    <Card className="overflow-hidden border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] p-0 transition-colors hover:border-[color:var(--color-ash)]">
      <div className="relative h-40 overflow-hidden border-b border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] p-4">
        <div className="pointer-events-none absolute inset-0">
          <DotMapGraphic
            seed={agent.id}
            variant={patternVariant}
            width={340}
            height={220}
            backgroundColor="var(--color-carbon)"
            dotColor="var(--color-chalk)"
            className="absolute inset-0 h-full w-full"
          />
        </div>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.06),transparent_42%)]" />
        <div className="absolute left-4 top-4 flex h-16 w-16 items-center justify-center rounded-[20px] border border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)]/80 shadow-[0_0_30px_rgba(111,103,89,0.12)] backdrop-blur-sm">
          <AgentIcon seed={agent.id} size={28} />
        </div>

        <div className="absolute right-4 top-4">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpen((value) => !value);
            }}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)]/80 text-[color:var(--color-chalk)] backdrop-blur-sm"
            aria-label="Открыть меню агента"
          >
            <MoreHorizontal size={18} />
          </button>
        </div>

        {menuOpen ? (
          <div className="absolute right-4 top-16 z-10 w-48 rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] p-2">
            <button
              type="button"
              onClick={() => {
                router.push(`/dashboard/${agent.id}`);
                setMenuOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-[var(--radius-cards)] px-3 py-2 text-left text-sm text-[color:var(--color-smoke)] hover:bg-[color:var(--color-obsidian)] hover:text-[color:var(--color-chalk)]"
            >
              <ExternalLink size={16} /> Открыть
            </button>
            <button
              type="button"
              onClick={() => {
                router.push(`/dashboard/${agent.id}/settings`);
                setMenuOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-[var(--radius-cards)] px-3 py-2 text-left text-sm text-[color:var(--color-smoke)] hover:bg-[color:var(--color-obsidian)] hover:text-[color:var(--color-chalk)]"
            >
              <Settings size={16} /> Настройки
            </button>
            {canDelete ? (
              <ConfirmDialog
                title={`Удалить агента «${agent.name}»?`}
                description="Это действие необратимо. Все диалоги, история, база знаний и логи этого агента будут удалены безвозвратно."
                confirmLabel="Удалить"
                onConfirm={handleDelete}
              >
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-[var(--radius-cards)] px-3 py-2 text-left text-sm text-[color:var(--color-smoke)] hover:bg-[color:var(--color-obsidian)] hover:text-[color:var(--color-chalk)]"
                >
                  <Trash2 size={16} /> Удалить
                </button>
              </ConfirmDialog>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="cursor-pointer p-5" onClick={handleCardClick}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Avatar name={agent.name} size="md" />
            <div>
              <h2 className="text-lg font-normal text-[color:var(--color-chalk)]">{agent.name}</h2>
              <p className="mt-1 text-sm text-[color:var(--color-smoke)]">{agent.role || agent.description || 'Описание отсутствует.'}</p>
            </div>
          </div>
          <Badge color="gray">{agent.description ? 'Активен' : 'Черновик'}</Badge>
        </div>
      </div>

      {error ? <p className="px-5 pb-4 text-sm text-[color:var(--color-smoke)]">{error}</p> : null}
    </Card>
  );
}
