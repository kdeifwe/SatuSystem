import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="container">
      <h1>Страница не найдена</h1>
      <p>Похоже, вы попали на несуществующую страницу.</p>
      <Link href="/">Вернуться на главную</Link>
    </main>
  );
}
