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
      <main className="container py-10">
        <div className="hyper-card max-w-md">
          <h1 className="text-[28px] mb-6 text-[color:var(--color-chalk)] font-normal">Создать организацию</h1>
          <form onSubmit={handleSubmit}>
            <div className="form-field">
              <label htmlFor="name" className="hyper-label">Название организации</label>
              <input
                id="name"
                className="hyper-input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>
            <div className="form-field">
              <label htmlFor="timezone" className="hyper-label">Часовой пояс</label>
              <input
                id="timezone"
                className="hyper-input"
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
                required
              />
            </div>
            <div className="form-field">
              <label htmlFor="currency" className="hyper-label">Валюта</label>
              <input
                id="currency"
                className="hyper-input"
                value={currency}
                onChange={(event) => setCurrency(event.target.value)}
                required
              />
            </div>
            <div className="mt-6">
              <button type="submit" disabled={loading} className="hyper-primary-btn">
                {loading ? 'Создание...' : 'Создать организацию'}
              </button>
            </div>
          </form>
        </div>
        {message ? <p className="mt-4 text-[color:var(--color-smoke)]">{message}</p> : null}
      </main>
    </>
  );
}
