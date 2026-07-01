import { type HTMLAttributes, type ReactNode } from 'react';
import { cn } from './utils';

interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action, className, ...props }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-gray-200 bg-white px-6 py-12 text-center gap-4',
        className
      )}
      {...props}
    >
      {icon}
      <div>
        <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
        <p className="mt-2 text-sm text-gray-500">{description}</p>
      </div>
      {action}
    </div>
  );
}
