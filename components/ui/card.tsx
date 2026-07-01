import { type HTMLAttributes } from 'react';
import { cn } from './utils';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padded?: boolean;
}

export function Card({ className, padded = true, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-gray-200 bg-white shadow-sm',
        padded ? 'p-6' : '',
        className
      )}
      {...props}
    />
  );
}
