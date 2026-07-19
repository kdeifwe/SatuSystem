import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Plus, Bot } from 'lucide-react';
import { createClient } from '../../lib/supabase/server';
import { AgentCard } from '../../components/dashboard/agent-card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { EmptyState } from '../../components/ui/empty-state';

async function deleteAgent(agentId: string) {
  'use server';
  const supabase = createClient();
  const { error } = await supabase.from('agents').delete().eq('id', agentId);

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}

type Agent = {
  id: string;
  name: string;
  role: string | null;
  description: string | null;
  is_active: boolean | null;
};

export default async function DashboardPage() {
  const supabase = createClient();
  const {
    data: { user },
    error: sessionError,
  } = await supabase.auth.getUser();

  if (sessionError || !user) {
    redirect('/login');
  }

  const { data } = await supabase
    .from('agents')
    .select('id, name, role, is_active, created_at')
    .order('created_at', { ascending: false });

  const agents: Agent[] = (data ?? []).map((agent: any) => ({
    id: agent.id,
    name: agent.name,
    role: agent.role ?? null,
    description: agent.role ?? null,
    is_active: agent.is_active ?? null,
  }));

  return (
    <main className="min-h-screen bg-[color:var(--color-obsidian)] px-4 py-8 text-[color:var(--color-chalk)] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <Card className="flex flex-col gap-4 border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div>
            <Badge color="gray">Satu.AI</Badge>
            <h1 className="mt-4 text-3xl font-normal tracking-[-0.02em] text-[color:var(--color-chalk)]">Дашборд</h1>
            <p className="mt-2 text-sm text-[color:var(--color-smoke)]">Управляйте ИИ-агентами в одном месте</p>
          </div>

          <Link href="/dashboard/create">
            <Button variant="primary" type="button" className="px-5 py-3">
              <span className="flex items-center gap-2">
                Создать ИИ-агента
                <Plus size={16} />
              </span>
            </Button>
          </Link>
        </Card>

        <div className="mt-8">
          {agents.length > 0 ? (
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              {agents.map((agent) => (
                <AgentCard key={agent.id} agent={agent} deleteAgent={deleteAgent} />
              ))}
            </div>
          ) : (
            <div className="mt-12">
              <EmptyState
                icon={
                  <div className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-full border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] text-[color:var(--color-chalk)]">
                    <Bot size={28} />
                  </div>
                }
                title="У вас пока нет ни одного ИИ-агента"
                description="Создайте первого агента, чтобы начать автоматизировать общение и поддержку клиентов."
                action={
                  <Link href="/dashboard/create">
                    <Button variant="primary" type="button" className="px-5 py-3">
                      Создать первого агента
                    </Button>
                  </Link>
                }
                className="mx-auto max-w-xl"
              />
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
