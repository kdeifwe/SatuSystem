import { type HTMLAttributes } from 'react';
import { cn } from './utils';

export interface BadgeProps extends HTMLAttributes<HTMLDivElement> {
  color?: 'emerald' | 'purple' | 'indigo' | 'amber' | 'gray' | 'slate';
}

const colorClasses: Record<NonNullable<BadgeProps['color']>, string> = {
  emerald: 'bg-emerald-100 text-emerald-700',
  purple: 'bg-purple-100 text-purple-700',
  indigo: 'bg-indigo-100 text-indigo-700',
  amber: 'bg-amber-100 text-amber-700',
  gray: 'bg-gray-100 text-gray-600',
  slate: 'bg-slate-100 text-slate-600',
};

export function Badge({ className, color = 'gray', ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium',
        colorClasses[color],
        className
      )}
      {...props}
    />
  );
}
