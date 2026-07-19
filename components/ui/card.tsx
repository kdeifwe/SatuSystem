import { type HTMLAttributes } from 'react';
import { cn } from './utils';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padded?: boolean;
}

export function Card({ className, padded = true, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)]',
        padded ? 'p-6' : '',
        className
      )}
      {...props}
    />
  );
}
