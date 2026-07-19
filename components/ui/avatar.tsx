import { type HTMLAttributes } from 'react';
import { cn } from './utils';

interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
  name?: string | null;
  size?: 'sm' | 'md';
}

export function Avatar({ name, size = 'md', className, ...props }: AvatarProps) {
  const initials = (name ?? '').trim().slice(0, 1).toUpperCase() || 'S';
  const sizeClasses = size === 'sm' ? 'h-8 w-8 text-xs' : 'h-10 w-10 text-sm';

  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-full border border-[color:var(--color-graphite)] bg-[color:var(--color-graphite)] text-[color:var(--color-chalk)] font-medium uppercase',
        sizeClasses,
        className
      )}
      {...props}
    >
      {initials}
    </div>
  );
}
