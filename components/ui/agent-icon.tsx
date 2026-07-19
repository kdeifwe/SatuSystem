'use client';

import { useMemo } from 'react';

type AgentIconProps = {
  seed?: string | number | null;
  size?: number;
  className?: string;
};

function getVariant(seed?: string | number | null) {
  if (seed === undefined || seed === null || seed === '') {
    return 0;
  }

  const value = typeof seed === 'number'
    ? seed
    : Array.from(String(seed)).reduce((result, char) => result + char.charCodeAt(0), 0);

  return value % 3;
}

export default function AgentIcon({ seed, size = 28, className = '' }: AgentIconProps) {
  const variant = useMemo(() => getVariant(seed), [seed]);
  const accentColor = variant === 2 ? 'var(--color-chalk)' : 'var(--color-compass-gold)';
  const rotation = variant === 0 ? -6 : variant === 1 ? 4 : 0;

  return (
    <div
      className={`inline-flex items-center justify-center ${className}`.trim()}
      style={{ width: size, height: size, color: accentColor }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 64 64"
        width={size}
        height={size}
        style={{ transform: `rotate(${rotation}deg)` }}
        className="h-full w-full"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {variant === 0 ? (
          <>
            <rect x="18" y="18" width="28" height="28" rx="10" />
            <circle cx="28" cy="32" r="2.2" />
            <circle cx="36" cy="32" r="2.2" />
            <path d="M28 40c2 2 6 2 8 0" />
            <path d="M24 16l4 6" />
            <path d="M40 16l-4 6" />
          </>
        ) : null}

        {variant === 1 ? (
          <>
            <path d="M20 18h24a8 8 0 0 1 8 8v12a8 8 0 0 1-8 8H28l-8 8v-8H20a8 8 0 0 1-8-8V26a8 8 0 0 1 8-8Z" />
            <circle cx="28" cy="31" r="2" />
            <circle cx="36" cy="31" r="2" />
            <path d="M28 39c2.5 2 5.5 2 8 0" />
          </>
        ) : null}

        {variant === 2 ? (
          <>
            <path d="M18 36c4-10 10-14 14-14 5 0 9 4 14 14" />
            <path d="M20 41c4-6 8-8 12-8s8 2 12 8" />
            <path d="M24 28h16" />
          </>
        ) : null}
      </svg>
    </div>
  );
}
