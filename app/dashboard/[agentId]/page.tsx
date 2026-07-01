import { redirect } from 'next/navigation';

export default function AgentIndexPage({ params }: { params: { agentId: string } }) {
  redirect(`/dashboard/${params.agentId}/sandbox`);
}
