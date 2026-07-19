import { type HTMLAttributes } from 'react';
import { cn } from './utils';

export interface BadgeProps extends HTMLAttributes<HTMLDivElement> {
  color?: 'emerald' | 'purple' | 'indigo' | 'amber' | 'gray' | 'slate';
}

const colorClasses: Record<NonNullable<BadgeProps['color']>, string> = {
  emerald: 'border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] text-[color:var(--color-chalk)]',
  purple: 'border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] text-[color:var(--color-smoke)]',
  indigo: 'border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] text-[color:var(--color-smoke)]',
  amber: 'border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] text-[color:var(--color-smoke)]',
  gray: 'border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] text-[color:var(--color-smoke)]',
  slate: 'border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] text-[color:var(--color-smoke)]',
};

export function Badge({ className, color = 'gray', ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em]',
        colorClasses[color],
        className
      )}
      {...props}
    >
      <span className="h-2.5 w-2.5 rounded-full bg-[color:var(--color-pulse-green)]" />
      <span>{props.children}</span>
    </div>
  );
}
