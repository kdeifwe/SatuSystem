'use client';

import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

const roles = ['member', 'admin', 'owner'] as const;

export default function InviteForm() {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<typeof roles[number]>('member');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      const response = await fetch('/api/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role }),
      });

      const result = await response.json();
      setLoading(false);

      if (!response.ok) {
        setMessage(result.error || 'Не удалось создать приглашение.');
        return;
      }

      setEmail('');
      setRole('member');
      setMessage(
        result.token
          ? `Приглашение создано. Токен: ${result.token}`
          : 'Приглашение создано.'
      );
    } catch (error) {
      setLoading(false);
      setMessage('Ошибка сети. Повторите попытку позже.');
    }
  }

  return (
    <Card className="p-6">
      <h2 className="text-xl font-medium text-[color:var(--color-chalk)]">Создать приглашение</h2>
      <p className="mt-2 text-sm text-[color:var(--color-smoke)]">
        Введите email получателя и роль. Токен приглашения будет показан на экране.
      </p>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div className="space-y-2">
          <label htmlFor="invite-email" className="block text-sm text-[color:var(--color-smoke)]">
            Email
          </label>
          <input
            id="invite-email"
            type="email"
            className="w-full rounded border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-[color:var(--color-chalk)]"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="invite-role" className="block text-sm text-[color:var(--color-smoke)]">
            Роль
          </label>
          <select
            id="invite-role"
            className="w-full rounded border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-[color:var(--color-chalk)]"
            value={role}
            onChange={(event) => setRole(event.target.value as typeof roles[number])}
          >
            {roles.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        <Button type="submit" disabled={loading} variant="primary">
          {loading ? 'Создание...' : 'Сгенерировать приглашение'}
        </Button>

        {message ? <p className="text-sm text-[color:var(--color-smoke)]">{message}</p> : null}
      </form>
    </Card>
  );
}
