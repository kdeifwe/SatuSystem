import { type HTMLAttributes, type ReactNode } from 'react';
import { cn } from './utils';
import { Card } from './card';

interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action, className, ...props }: EmptyStateProps) {
  return (
    <Card className={cn('flex flex-col items-center justify-center gap-4 border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] px-6 py-12 text-center', className)} {...props}>
      {icon}
      <div>
        <h2 className="text-xl font-semibold text-[color:var(--color-chalk)]">{title}</h2>
        <p className="mt-2 text-sm text-[color:var(--color-smoke)]">{description}</p>
      </div>
      {action}
    </Card>
  );
}
