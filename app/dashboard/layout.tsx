import type { ReactNode } from 'react';
import Link from 'next/link';
import { Avatar } from '@/components/ui/avatar';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[color:var(--color-obsidian)] text-[color:var(--color-chalk)]">
      <header className="border-b border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)]">
        <div className="container mx-auto flex flex-wrap items-center justify-between gap-4 px-4 py-4">
          <div className="flex flex-wrap items-center gap-8">
            <Link href="/dashboard" className="text-lg font-normal uppercase tracking-[0.2em] text-[color:var(--color-chalk)]">
              Satu.AI
            </Link>
            <nav className="flex flex-wrap items-center gap-4 text-sm uppercase tracking-[0.16em] text-[color:var(--color-smoke)]">
              <Link href="/dashboard" className="transition-colors hover:text-[color:var(--color-chalk)]">
                Дашборд
              </Link>
              <Link href="/dashboard/invites" className="transition-colors hover:text-[color:var(--color-chalk)]">
                Приглашения
              </Link>
              <Link href="/dashboard/settings" className="transition-colors hover:text-[color:var(--color-chalk)]">
                Настройки
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <Avatar name="S" />
          </div>
        </div>
      </header>
      <main className="min-h-[calc(100vh-73px)]">{children}</main>
    </div>
  );
}
