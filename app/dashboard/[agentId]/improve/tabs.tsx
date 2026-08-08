'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface ImproveTabsProps {
  agentId: string;
}

function tabClasses(isActive: boolean) {
  return `rounded-full border px-3 py-1 text-sm font-medium transition ${
    isActive
      ? 'border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] text-[color:var(--color-chalk)]'
      : 'border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] text-[color:var(--color-smoke)] hover:border-[color:var(--color-ash)]'
  }`;
}

export function ImproveTabs({ agentId }: ImproveTabsProps) {
  const pathname = usePathname();
  const improvePath = `/dashboard/${agentId}/improve`;
  const flowPath = `${improvePath}/flow`;
  const isFlow = pathname === flowPath;
  const isImprove = pathname === improvePath || pathname === `${improvePath}/`;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-[color:var(--color-smoke)]">
      <Link href={improvePath} className={tabClasses(isImprove)}>
        Улучшение
      </Link>
      <Link href={flowPath} className={tabClasses(isFlow)}>
        Скрипт продаж
      </Link>
    </div>
  );
}
