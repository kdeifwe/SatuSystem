'use client';

import { useMemo } from 'react';

type DotMapGraphicProps = {
  className?: string;
  width?: number;
  height?: number;
  seed?: string;
  variant?: number;
  dotColor?: string;
  backgroundColor?: string;
};

function getSeedHash(seed?: string) {
  if (!seed) {
    return 0;
  }

  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash);
}

export default function DotMapGraphic({
  className,
  width = 1400,
  height = 420,
  seed,
  variant,
  dotColor = 'var(--color-chalk)',
  backgroundColor = 'var(--color-obsidian)',
}: DotMapGraphicProps) {
  const resolvedVariant = variant ?? (getSeedHash(seed) % 3);
  const dots = useMemo(() => {
    const step = Math.max(4, Math.round(Math.min(width, height) / 90));
    const result: Array<{ x: number; y: number; radius: number }> = [];
    const seedHash = getSeedHash(seed);

    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const nx = x / width;

        const central = Math.max(0, 1 - Math.hypot(x - width * 0.5, y - height * 0.58) / (width * 0.28));
        const left = Math.max(0, 1 - Math.hypot(x - width * 0.34, y - height * 0.58) / (width * 0.22));
        const right = Math.max(0, 1 - Math.hypot(x - width * 0.66, y - height * 0.59) / (width * 0.22));
        const wave = Math.sin(nx * Math.PI * 2.1 + 0.55 + resolvedVariant * 0.3) * 0.08;
        let shape = Math.max(0, Math.max(central, left, right) + wave);

        if (resolvedVariant === 1) {
          const grid = Math.sin((x / width) * Math.PI * 2.7 + 0.15) * 0.06 + Math.cos((y / height) * Math.PI * 1.9 - 0.2) * 0.04;
          shape = Math.max(0, Math.max(shape, Math.max(0, 0.68 - Math.abs(nx - 0.5) * 1.4) + grid));
        } else if (resolvedVariant === 2) {
          const orb = Math.max(0, 1 - Math.hypot(x - width * 0.5, y - height * 0.5) / (width * 0.2));
          const line = Math.max(0, 1 - Math.abs(nx - 0.5) / 0.24) * 0.35;
          shape = Math.max(0, Math.max(orb, line) + Math.sin((y / height) * Math.PI * 1.6 + 0.35) * 0.08);
        }

        const noise = (Math.sin(x * 0.035 + y * 0.015 + seedHash * 0.01) + Math.cos(y * 0.028 - x * 0.018 + seedHash * 0.008) + 1) / 2;
        const threshold = 0.16 + shape * 0.72;

        if (noise < threshold) {
          const radius = shape > 0.74 ? 2.2 : shape > 0.5 ? 1.65 : 1.05;
          result.push({ x, y, radius });
        }
      }
    }

    return result;
  }, [height, resolvedVariant, seed, width]);

  return (
    <div className={['relative overflow-hidden', className ?? 'h-[260px] md:h-[340px]'].filter(Boolean).join(' ')}>
      <div className="h-full w-full" style={{ backgroundColor }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-full w-full"
          xmlns="http://www.w3.org/2000/svg"
          aria-label="Dot map graphic"
          role="img"
        >
          <rect x="0" y="0" width={width} height={height} fill={backgroundColor} />
          {dots.map((dot, index) => (
            <circle
              key={`${dot.x}-${dot.y}-${index}`}
              cx={dot.x}
              cy={dot.y}
              r={dot.radius}
              fill={dotColor}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}
