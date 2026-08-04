import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  MessageSquare,
  BookOpen,
  FlaskConical,
  Sparkles,
  Send,
  GitBranch,
  Settings,
  BarChart3,
  Puzzle,
  Zap,
  Wrench,
  Mic,
  Tag,
  Lightbulb,
  ChevronDown,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Avatar } from '@/components/ui/avatar';
import { applyAgentVisibilityFilter } from '@/lib/agents/visibility';

const navSections = [
  {
    label: 'Основные',
    items: [
      { href: 'dialogs', icon: MessageSquare, label: 'Диалоги' },
      { href: 'knowledge', icon: BookOpen, label: 'База знаний' },
      { href: 'sandbox', icon: FlaskConical, label: 'Тестирование' },
      { href: 'improve', icon: Sparkles, label: 'Улучшение' },
      { href: 'broadcasts', icon: Send, label: 'Рассылки' },
      { href: 'scenarios', icon: GitBranch, label: 'Сценарии' },
      { href: 'settings', icon: Settings, label: 'Настройки' },
    ],
  },
  {
    label: 'Аналитика',
    items: [{ href: 'stats', icon: BarChart3, label: 'Статистика' }],
  },
  {
    label: 'ПРОДАЖИ',
    items: [
      { href: '/dashboard/sales-niches', icon: Tag, label: 'Ниши' },
      { href: '/dashboard/sales-techniques', icon: Lightbulb, label: 'Техники' },
      { href: '/dashboard/sales-examples', icon: MessageSquare, label: 'Примеры' },
    ],
  },
  {
    label: 'Интеграции',
    items: [
      { href: 'integrations', icon: Puzzle, label: 'Интеграции' },
      { href: 'extensions', icon: Zap, label: 'Расширения' },
      { href: 'tools', icon: Wrench, label: 'Инструменты' },
      { href: 'voice', icon: Mic, label: 'Голосовой агент' },
    ],
  },
];

export default async function AgentLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { agentId: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: agent } = await applyAgentVisibilityFilter(
    supabase.from('agents').select('id, name, role, deleted_at')
  )
    .eq('id', params.agentId)
    .maybeSingle();

  if (!agent) {
    redirect('/dashboard?deleted=1');
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[color:var(--color-obsidian)] text-[color:var(--color-chalk)]">
      <aside className="flex w-[220px] flex-shrink-0 flex-col border-r border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)]">
        <div className="border-b border-[color:var(--color-graphite)] px-4 py-4">
          <Link href="/dashboard" className="mb-3 flex items-center gap-2 text-sm font-normal uppercase tracking-[0.16em] text-[color:var(--color-chalk)]">
            Satu.AI
          </Link>
          <div className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-2 py-2">
            <Avatar name={agent?.name ?? 'A'} size="sm" className="border-0" />
            <span className="flex-1 truncate text-sm font-medium text-[color:var(--color-chalk)]">
              {agent?.name ?? 'Агент'}
            </span>
            <ChevronDown size={14} className="flex-shrink-0 text-[color:var(--color-smoke)]" />
          </div>
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
          {navSections.map((section) => (
            <div key={section.label}>
              <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[color:var(--color-smoke)]">
                {section.label}
              </p>
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href.startsWith('/') ? item.href : `/dashboard/${params.agentId}/${item.href}`}
                      className="flex items-center gap-2.5 rounded-[var(--radius-cards)] px-2 py-2 text-sm text-[color:var(--color-smoke)] transition-colors hover:bg-[color:var(--color-obsidian)] hover:text-[color:var(--color-chalk)]"
                    >
                      <item.icon size={16} className="flex-shrink-0" />
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-[color:var(--color-graphite)] px-3 py-3">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 rounded-[var(--radius-cards)] px-2 py-2 text-xs text-[color:var(--color-smoke)] transition-colors hover:bg-[color:var(--color-obsidian)] hover:text-[color:var(--color-chalk)]"
          >
            ← Все агенты
          </Link>
        </div>
      </aside>

      <main className="flex w-full flex-1 min-h-0 overflow-y-auto bg-[color:var(--color-obsidian)]">
        <div className="min-h-full w-full">{children}</div>
      </main>
    </div>
  );
}
