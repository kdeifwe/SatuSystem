import type { ReactNode } from 'react';
import Link from 'next/link';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-gray-200 bg-white shadow-sm">
        <div className="container mx-auto flex flex-wrap items-center justify-between gap-4 px-4 py-4">
          <div className="flex flex-wrap items-center gap-8">
            <span className="text-lg font-semibold text-gray-900">Satu.AI</span>
            <nav className="flex flex-wrap items-center gap-4 text-sm font-medium text-gray-600">
              <Link href="/dashboard" className="text-gray-900 hover:text-gray-900">
                Дашборд
              </Link>
              <Link href="/dashboard/team" className="hover:text-gray-900">
                Команда
              </Link>
              <Link href="/dashboard/settings" className="hover:text-gray-900">
                Настройки
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#1557FF] text-sm font-semibold uppercase text-white shadow-sm">
              S
            </div>
          </div>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
