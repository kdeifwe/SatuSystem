'use client';

import { User } from 'lucide-react';

const PALETTE = [
  { bg: 'bg-blue-100', text: 'text-blue-600' },
  { bg: 'bg-green-100', text: 'text-green-600' },
  { bg: 'bg-purple-100', text: 'text-purple-600' },
  { bg: 'bg-orange-100', text: 'text-orange-600' },
  { bg: 'bg-pink-100', text: 'text-pink-600' },
  { bg: 'bg-teal-100', text: 'text-teal-600' },
];

function getColorIndex(name: string) {
  const code = name.charCodeAt(0);
  return Math.abs(code) % PALETTE.length;
}

interface AvatarInitialProps {
  name?: string | null;
}

export default function AvatarInitial({ name }: AvatarInitialProps) {
  if (!name) {
    return (
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-400">
        <User size={16} />
      </div>
    );
  }

  const initial = name.trim()[0].toUpperCase();
  const color = PALETTE[getColorIndex(initial)];

  return (
    <div className={`flex h-9 w-9 items-center justify-center rounded-full ${color.bg} ${color.text}`}>
      <span className="text-sm font-semibold">{initial}</span>
    </div>
  );
}
