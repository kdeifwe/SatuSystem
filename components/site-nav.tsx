import Link from 'next/link';

export default function SiteNav() {
  return (
    <nav className="border-b border-[color:var(--color-graphite)] bg-transparent">
      <div className="container flex flex-wrap items-center justify-between gap-4 py-4">
        <Link href="/" className="text-[18px] font-normal uppercase tracking-[0.16em] text-[color:var(--color-chalk)]">
          SatuSystem
        </Link>
        <div className="flex flex-wrap items-center gap-5">
          <Link href="/" className="hyper-nav-link">
            Главная
          </Link>
          <Link href="/dashboard" className="hyper-nav-link">
            Dashboard
          </Link>
          <Link href="/login" className="hyper-nav-link">
            Вход
          </Link>
          <Link href="/register" className="hyper-nav-link">
            Регистрация по приглашению
          </Link>
        </div>
        <Link href="/login" className="hyper-secondary-btn">
          Войти
        </Link>
      </div>
    </nav>
  );
}
