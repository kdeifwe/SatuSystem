import Link from 'next/link';
import SiteNav from '../components/site-nav';

export default function HomePage() {
  return (
    <>
      <SiteNav />
      <main className="container">
        <h1>Добро пожаловать в SatuSystem</h1>
        <p>Платформа AI-агентов для продаж, поддержки и консультаций через WhatsApp и Telegram.</p>
        <div className="grid gap-3 mt-6">
          <Link href="/login">Войти</Link>
          <Link href="/register">Регистрация</Link>
          <Link href="/org/create">Создать организацию</Link>
          <Link href="/dashboard">Дашборд</Link>
        </div>
      </main>
    </>
  );
}
