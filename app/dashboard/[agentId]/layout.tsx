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
  ChevronDown,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';

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

  const { data: agent } = await supabase
    .from('agents')
    .select('id, name, role')
    .eq('id', params.agentId)
    .single();

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <aside className="flex w-[220px] flex-shrink-0 flex-col border-r border-gray-100 bg-white">
        <div className="border-b border-gray-100 px-4 py-4">
          <Link href="/dashboard" className="mb-3 flex items-center gap-2">
            <span className="text-sm font-bold text-gray-900">Satu.AI</span>
          </Link>
          <div className="flex cursor-pointer items-center gap-2 rounded-lg bg-gray-50 px-2 py-2 hover:bg-gray-100">
            <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
              {agent?.name?.[0] ?? 'A'}
            </div>
            <span className="flex-1 truncate text-sm font-medium text-gray-800">
              {agent?.name ?? 'Агент'}
            </span>
            <ChevronDown size={14} className="flex-shrink-0 text-gray-400" />
          </div>
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
          {navSections.map((section) => (
            <div key={section.label}>
              <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                {section.label}
              </p>
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={`/dashboard/${params.agentId}/${item.href}`}
                      className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
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

        <div className="border-t border-gray-100 px-3 py-3">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 rounded-lg px-2 py-2 text-xs text-gray-500 hover:bg-gray-100"
          >
            ← Все агенты
          </Link>
        </div>
      </aside>

      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
