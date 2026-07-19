'use client';

import SiteNav from '../../../components/site-nav';
import { useState, type FormEvent } from 'react';

export default function RegisterPage() {
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      const response = await fetch('/api/invites/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });

      const result = await response.json();
      setLoading(false);

      if (!response.ok) {
        setMessage(result.error || 'Ошибка регистрации. Попробуйте позже.');
        return;
      }

      setToken('');
      setPassword('');
      setMessage('Регистрация завершена. Войдите с вашим email и паролем.');
    } catch (error) {
      setLoading(false);
      setMessage('Ошибка подключения. Повторите попытку позже.');
    }
  }

  return (
    <>
      <SiteNav />
      <main className="container">
        <div className="card">
          <h1>Регистрация</h1>
        <form onSubmit={handleSubmit}>
          <div className="form-field">
            <label htmlFor="token">Токен приглашения</label>
            <input
              id="token"
              type="text"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              required
            />
          </div>
          <div className="form-field">
            <label htmlFor="password">Пароль</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>
          <button type="submit" disabled={loading}>
            {loading ? 'Регистрация...' : 'Зарегистрироваться'}
          </button>
        </form>
        </div>
        {message ? <p>{message}</p> : null}
      </main>
    </>
  );
}
