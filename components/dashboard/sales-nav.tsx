'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Tag, Lightbulb, MessageSquare } from 'lucide-react';

export function SalesNav() {
  const pathname = usePathname();

  const links = [
    { href: '/dashboard/sales-niches', label: 'Ниши', icon: Tag },
    { href: '/dashboard/sales-techniques', label: 'Техники', icon: Lightbulb },
    { href: '/dashboard/sales-examples', label: 'Примеры', icon: MessageSquare },
  ];

  return (
    <nav className="flex flex-wrap gap-2 mb-6">
      {links.map((link) => {
        const Icon = link.icon;
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);

        return (
          <Link
            key={link.href}
            href={link.href}
            className={`flex items-center gap-2 rounded-[var(--radius-cards)] border px-4 py-2 text-sm font-medium transition-colors ${
              active
                ? 'border-[color:var(--color-signal-white)] bg-[color:var(--color-signal-white)] text-[color:var(--color-obsidian)]'
                : 'border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] text-[color:var(--color-smoke)] hover:border-[color:var(--color-chalk)] hover:text-[color:var(--color-chalk)]'
            }`}
          >
            <Icon className="h-4 w-4 text-[color:var(--color-chalk)]" />
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
