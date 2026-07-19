import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from './utils';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
}

const variantClasses: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary:
    'border border-[color:var(--color-signal-white)] bg-[color:var(--color-signal-white)] text-[color:var(--color-obsidian)] hover:bg-[color:var(--color-chalk)] rounded-full uppercase tracking-[0.12em]',
  outline:
    'border border-[color:var(--color-chalk)] bg-transparent text-[color:var(--color-chalk)] hover:border-[color:var(--color-ash)] hover:text-[color:var(--color-ash)] rounded-[var(--radius-cards)]',
  ghost:
    'border border-[color:var(--color-graphite)] bg-transparent text-[color:var(--color-smoke)] hover:border-[color:var(--color-ash)] hover:text-[color:var(--color-chalk)] rounded-[var(--radius-cards)]',
  danger:
    'border border-transparent bg-[color:var(--color-iron)] text-[color:var(--color-chalk)] hover:border-[color:var(--color-graphite)]',
};

const sizeClasses: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-11 px-4 text-sm',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', type = 'button', ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          'inline-flex items-center justify-center gap-2 font-normal transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-ash)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--color-obsidian)] disabled:cursor-not-allowed disabled:opacity-60',
          variantClasses[variant],
          sizeClasses[size],
          className
        )}
        {...props}
      />
    );
  }
);

Button.displayName = 'Button';
