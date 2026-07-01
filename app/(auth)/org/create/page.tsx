'use client';

import SiteNav from '../../../../components/site-nav';
import { useState, type FormEvent } from 'react';
import { getSupabaseClient } from '../../../../lib/supabase-browser';

export default function CreateOrgPage() {
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('Asia/Almaty');
  const [currency, setCurrency] = useState('KZT');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage('');

    const supabase = getSupabaseClient();
    const { data: orgData, error: orgError } = await supabase
      .from('organizations')
      .insert([{ name, timezone, currency }])
      .select('*')
      .single();

    if (orgError || !orgData) {
      setMessage(orgError?.message ?? 'Не удалось создать организацию.');
      setLoading(false);
      return;
    }

    const user = await supabase.auth.getUser();
    if (!user.data.user) {
      setMessage('Ошибка: пользователь не найден. Выполните вход.');
      setLoading(false);
      return;
    }

    await supabase.from('profiles').upsert({
      id: user.data.user.id,
      email: user.data.user.email,
      full_name: null,
    });

    const { error: memberError } = await supabase.from('org_members').insert([
      {
        org_id: orgData.id,
        user_id: user.data.user.id,
        role: 'owner',
      },
    ]);

    setLoading(false);

    if (memberError) {
      setMessage(memberError.message);
      return;
    }

    setMessage('Организация создана. Перейдите в дашборд, чтобы продолжить.');
  }

  return (
    <>
      <SiteNav />
      <main className="container">
        <div className="card">
          <h1>Создать организацию</h1>
        <form onSubmit={handleSubmit}>
          <div className="form-field">
            <label htmlFor="name">Название организации</label>
            <input
              id="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>
          <div className="form-field">
            <label htmlFor="timezone">Часовой пояс</label>
            <input
              id="timezone"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              required
            />
          </div>
          <div className="form-field">
            <label htmlFor="currency">Валюта</label>
            <input
              id="currency"
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
              required
            />
          </div>
          <button type="submit" disabled={loading}>
            {loading ? 'Создание...' : 'Создать организацию'}
          </button>
        </form>
        </div>
        {message ? <p>{message}</p> : null}
      </main>
    </>
  );
}
