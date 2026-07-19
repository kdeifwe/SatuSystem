import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'SatuSystem',
  description: 'SaaS-платформа AI-агентов для бизнеса',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className={`${inter.variable} min-h-screen bg-[color:var(--color-obsidian)] font-sans text-[color:var(--color-chalk)]`}>
        {children}
      </body>
    </html>
  );
}
