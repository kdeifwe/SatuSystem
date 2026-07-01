import Link from 'next/link';

export default function SiteNav() {
  return (
    <nav className="border-b border-gray-200 bg-white">
      <div className="container mx-auto flex flex-wrap items-center gap-4 px-4 py-4">
        <Link href="/" className="font-semibold text-gray-900">
          Satu.AI
        </Link>
        <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
          <Link href="/">Главная</Link>
          <Link href="/dashboard">Дашборд</Link>
          <Link href="/login">Вход</Link>
          <Link href="/register">Регистрация</Link>
        </div>
      </div>
    </nav>
  );
}
