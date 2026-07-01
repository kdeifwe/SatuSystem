import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Plus, Bot, Sparkles } from 'lucide-react';
import { createClient } from '../../lib/supabase/server';
import { AgentCard } from '../../components/dashboard/agent-card';
import { Button } from '../../components/ui/button';
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
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-4 rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700">
              <Sparkles size={16} />
              Satu.AI
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Дашборд</h1>
            <p className="mt-2 text-sm text-slate-500">Управляйте ИИ-агентами в одном месте</p>
          </div>

          <Link href="/dashboard/create">
            <Button variant="primary" type="button" className="rounded-2xl bg-blue-600 px-5 py-3 text-white hover:bg-blue-700">
              <span className="flex items-center gap-2">
                Создать ИИ-агента +
                <Plus size={16} />
              </span>
            </Button>
          </Link>
        </div>

        <div className="mt-8">
          {agents.length > 0 ? (
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              {agents.map((agent) => (
                <AgentCard key={agent.id} agent={agent} deleteAgent={deleteAgent} />
              ))}
            </div>
          ) : (
            <div className="mt-12 rounded-[28px] border border-slate-200 bg-white p-10 text-center shadow-sm">
              <EmptyState
                icon={
                  <div className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                    <Bot size={28} />
                  </div>
                }
                title="У вас пока нет ни одного ИИ-агента"
                description="Создайте первого агента, чтобы начать автоматизировать общение и поддержку клиентов."
                action={
                  <Link href="/dashboard/create">
                    <Button variant="primary" type="button" className="rounded-2xl bg-blue-600 px-5 py-3 text-white hover:bg-blue-700">
                      Создать первого агента +
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
