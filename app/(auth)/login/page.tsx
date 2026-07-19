'use client';

import SiteNav from '../../../components/site-nav';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../../lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage('');

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage('Вход выполнен. Переадресуем на дашборд...');
    router.push('/dashboard');
  }

  return (
    <>
      <SiteNav />
      <main className="container py-10">
        <div className="hyper-card max-w-md">
          <h1 className="text-[28px] mb-6 text-[color:var(--color-chalk)] font-normal">Войти</h1>
          <form onSubmit={handleSubmit}>
            <div className="form-field">
              <label htmlFor="email" className="hyper-label">Email</label>
              <input
                id="email"
                className="hyper-input"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <div className="form-field">
              <label htmlFor="password" className="hyper-label">Пароль</label>
              <input
                id="password"
                className="hyper-input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>
            <div className="mt-6">
              <button type="submit" disabled={loading} className="hyper-primary-btn">
                {loading ? 'Вход...' : 'Войти'}
              </button>
            </div>
          </form>
        </div>
        {message ? <p className="mt-4 text-[color:var(--color-smoke)]">{message}</p> : null}
      </main>
    </>
  );
}
