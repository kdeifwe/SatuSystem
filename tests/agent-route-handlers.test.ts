import test from 'node:test';
import assert from 'node:assert/strict';

import { handleAgentCreate, handleAgentRoute } from '@/lib/server/agents/route-handlers';

function createFakeSupabase(initialState: Record<string, unknown>) {
  const state = {
    users: initialState.users as Array<Record<string, unknown>>,
    memberships: initialState.memberships as Array<Record<string, unknown>>,
    organizations: initialState.organizations as Array<Record<string, unknown>>,
    agents: initialState.agents as Array<Record<string, unknown>>,
  };

  return {
    state,
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1' } } }),
    },
    from(table: string) {
      if (table === 'org_members') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: state.memberships.find((item) => item.user_id === 'user-1') ?? null, error: null }),
            }),
          }),
        };
      }

      if (table === 'organizations') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: state.organizations[0] ?? null, error: null }),
            }),
          }),
        };
      }

      if (table === 'agents') {
        return {
          insert: (values: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                const agent = { id: 'agent-1', ...values };
                state.agents.push(agent);
                return { data: agent, error: null };
              },
            }),
          }),
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                const agent = state.agents.find((item) => item.id === 'agent-1');
                return { data: agent ?? null, error: null };
              },
            }),
          }),
          update: (values: Record<string, unknown>) => ({
            eq: async () => {
              const agent = state.agents.find((item) => item.id === 'agent-1');
              if (!agent) return { error: null };
              Object.assign(agent, values);
              return { error: null };
            },
          }),
          delete: () => ({
            eq: async () => {
              state.agents = state.agents.filter((item) => item.id !== 'agent-1');
              return { error: null };
            },
          }),
        };
      }

      throw new Error(`Unsupported table ${table}`);
    },
  } as any;
}

test('create -> get -> patch -> delete flow works through agent route handlers', async () => {
  const fakeSupabase = createFakeSupabase({
    users: [{ id: 'user-1' }],
    memberships: [{ user_id: 'user-1', org_id: 'org-1', role: 'owner' }],
    organizations: [{ id: 'org-1', agent_defaults: {} }],
    agents: [],
  });

  const createResult = await handleAgentCreate({
    supabase: fakeSupabase,
    compileAndSaveSystemPrompt: async () => undefined,
  });

  assert.equal(createResult.status, 200);
  assert.equal(createResult.body.agentId, 'agent-1');

  const getResult = await handleAgentRoute('GET', undefined, { agentId: 'agent-1' }, {
    supabase: fakeSupabase,
  });
  assert.equal(getResult.status, 200);
  assert.equal(getResult.body.id, 'agent-1');

  const patchResult = await handleAgentRoute('PATCH', { json: async () => ({ is_active: false, goal: 'Updated' }) }, { agentId: 'agent-1' }, {
    supabase: fakeSupabase,
    compileAndSaveSystemPrompt: async () => undefined,
  });
  assert.equal(patchResult.status, 200);
  assert.equal(patchResult.body.success, true);

  const deleteResult = await handleAgentRoute('DELETE', undefined, { agentId: 'agent-1' }, {
    supabase: fakeSupabase,
  });
  assert.equal(deleteResult.status, 200);
  assert.equal(deleteResult.body.success, true);
});

test('PATCH ignores protected fields that are not in the whitelist', async () => {
  const fakeSupabase = createFakeSupabase({
    users: [{ id: 'user-1' }],
    memberships: [{ user_id: 'user-1', org_id: 'org-1', role: 'owner' }],
    organizations: [{ id: 'org-1', agent_defaults: {} }],
    agents: [{ id: 'agent-1', org_id: 'org-1', created_at: '2024-01-01T00:00:00.000Z', goal: 'Old goal' }],
  });

  const patchResult = await handleAgentRoute('PATCH', {
    json: async () => ({ goal: 'Updated goal', org_id: 'evil-org', id: 'evil-id', created_at: '2030-01-01T00:00:00.000Z' }),
  }, { agentId: 'agent-1' }, {
    supabase: fakeSupabase,
  });

  assert.equal(patchResult.status, 200);
  assert.equal(patchResult.body.success, true);

  const agent = fakeSupabase.state.agents.find((item: Record<string, unknown>) => item.id === 'agent-1');
  assert.equal(agent?.goal, 'Updated goal');
  assert.equal(agent?.org_id, 'org-1');
  assert.equal(agent?.id, 'agent-1');
  assert.equal(agent?.created_at, '2024-01-01T00:00:00.000Z');
});

test('member role is rejected by route handlers for PATCH and DELETE', async () => {
  const fakeSupabase = createFakeSupabase({
    users: [{ id: 'user-1' }],
    memberships: [{ user_id: 'user-1', org_id: 'org-1', role: 'member' }],
    organizations: [{ id: 'org-1', agent_defaults: {} }],
    agents: [{ id: 'agent-1', org_id: 'org-1', goal: 'Goal' }],
  });

  const patchResult = await handleAgentRoute('PATCH', {
    json: async () => ({ goal: 'Attempted update' }),
  }, { agentId: 'agent-1' }, {
    supabase: fakeSupabase,
  });

  assert.equal(patchResult.status, 403);
  assert.match(String(patchResult.body.error), /Только владелец/);

  const deleteResult = await handleAgentRoute('DELETE', undefined, { agentId: 'agent-1' }, {
    supabase: fakeSupabase,
  });

  assert.equal(deleteResult.status, 403);
  assert.match(String(deleteResult.body.error), /Только владелец/);

  assert.equal(fakeSupabase.state.agents.length, 1);
});
