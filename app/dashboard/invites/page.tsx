import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import InviteForm from './invite-form';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

export default async function InvitesPage() {
  const supabase = createClient();
  const {
    data: { user },
    error: sessionError,
  } = await supabase.auth.getUser();

  if (sessionError || !user) {
    redirect('/login');
  }

  return (
    <main className="min-h-screen bg-[color:var(--color-obsidian)] px-4 py-8 text-[color:var(--color-chalk)] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <Card className="border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] p-6">
          <div className="flex flex-col gap-3">
            <Badge color="gray">Приглашения</Badge>
            <h1 className="text-3xl font-normal tracking-[-0.02em] text-[color:var(--color-chalk)]">Управление доступом</h1>
            <p className="text-sm text-[color:var(--color-smoke)]">
              Создавайте приглашения для новых пользователей. После генерации токен может быть отправлен получателю.
            </p>
          </div>
        </Card>

        <InviteForm />
      </div>
    </main>
  );
}
