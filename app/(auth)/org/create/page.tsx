'use client';

import Link from 'next/link';
import SiteNav from '../../../../components/site-nav';

export default function CreateOrgPage() {
  return (
    <>
      <SiteNav />
      <main className="container py-10">
        <div className="hyper-card max-w-xl">
          <h1 className="text-[28px] mb-6 text-[color:var(--color-chalk)] font-normal">
            Создание организации закрыто
          </h1>
          <p className="text-[color:var(--color-smoke)]">
            Новый доступ выдается только через приглашения. Если у вас есть приглашение,
            зарегистрируйтесь на странице регистрации и войдите в систему.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/register" className="hyper-secondary-btn">
              Регистрация по приглашению
            </Link>
            <Link href="/login" className="hyper-secondary-btn">
              Войти
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
