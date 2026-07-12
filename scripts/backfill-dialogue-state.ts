/**
 * Backfill dialogue state for leads with incomplete funnel context
 * 
 * Purpose:
 * - For leads with conversation history but missing current_funnel_step,
 *   infer the correct node from dialogue flow and message history
 * - Prevents restarting conversations when AI is re-enabled or system recovers
 * 
 * Process:
 * 1. Find conversations missing current_funnel_step
 * 2. Load funnel flow (dialogue_flow) from lead's entry funnel
 * 3. Analyze message history to detect which node was last visited
 * 4. Set current_funnel_step to that node (or entry node if no history)
 * 5. Log results to notification_log for audit trail
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createAdminClient } from '../lib/supabase/admin';
import { normalizeFunnelFlow } from '../lib/funnel/normalize';
import { inferCurrentNodeIdFromMessages } from '../lib/funnel/backfill';

interface ConversationRecord {
  id: string;
  lead_id: string;
  agent_id: string;
  current_funnel_step: string | null;
}

interface MessageRecord {
  id: string;
  conversation_id: string;
  sender: 'user' | 'assistant' | 'system' | 'ai' | 'model';
  content: string;
  created_at: string;
  tool_calls?: unknown;
  metadata?: any;
}

interface LeadRuntimeState {
  currentNodeId: string | null;
  pendingNodeId: string | null;
  pendingReply: string | null;
  attributes: Record<string, unknown>;
}

interface BackfillResult {
  updated: boolean;
  wouldUpdate: boolean;
  inferredNode: string | null;
  beforeCurrentNodeId: string | null;
  beforePendingNodeId: string | null;
  beforePendingReply: string | null;
}

interface CliArgs {
  dryRun: boolean;
  conversationIds: string[];
}

function parseCliArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    dryRun: false,
    conversationIds: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run' || arg === '--dryRun') {
      parsed.dryRun = true;
      continue;
    }

    if (arg === '--ids') {
      const nextValue = (argv[index + 1] ?? '').split(',').map((value) => value.trim()).filter(Boolean);
      parsed.conversationIds.push(...nextValue);
      index += 1;
      continue;
    }

    if (arg === '--conversation-id') {
      const nextValue = (argv[index + 1] ?? '').trim();
      if (nextValue) {
        parsed.conversationIds.push(nextValue);
      }
      index += 1;
    }
  }

  return parsed;
}

async function loadLeadRuntimeState(admin: any, leadId: string): Promise<LeadRuntimeState> {
  const { data: leadData, error: leadError } = await admin
    .from('leads')
    .select('id,attributes')
    .eq('id', leadId)
    .maybeSingle();

  if (leadError) {
    console.error(`[backfill] Failed to load lead ${leadId}:`, leadError);
    return { currentNodeId: null, pendingNodeId: null, pendingReply: null, attributes: {} };
  }

  const leadAttributes = (leadData?.attributes && typeof leadData.attributes === 'object'
    ? leadData.attributes
    : {}) as Record<string, unknown>;

  const currentNodeId = typeof leadAttributes.current_node_id === 'string' ? leadAttributes.current_node_id : null;

  const { data: funnelStateData, error: stateError } = await admin
    .from('lead_funnel_state')
    .select('current_node_id,pending_script_node_id,pending_script_reply')
    .eq('lead_id', leadId)
    .maybeSingle();

  if (stateError) {
    console.error(`[backfill] Failed to load lead funnel state for lead ${leadId}:`, stateError);
    return { currentNodeId, pendingNodeId: null, pendingReply: null, attributes: leadAttributes };
  }

  const durableCurrentNodeId = typeof funnelStateData?.current_node_id === 'string' ? funnelStateData.current_node_id : null;

  return {
    currentNodeId: durableCurrentNodeId ?? currentNodeId,
    pendingNodeId: typeof funnelStateData?.pending_script_node_id === 'string' ? funnelStateData.pending_script_node_id : null,
    pendingReply: typeof funnelStateData?.pending_script_reply === 'string' ? funnelStateData.pending_script_reply : null,
    attributes: leadAttributes,
  };
}

async function backfillConversation(
  admin: any,
  conversation: ConversationRecord,
  funnelFlow: any,
  dryRun: boolean,
): Promise<BackfillResult> {
  /**
   * Backfill a single conversation
   * Returns a detailed result for dry-run reporting
   */

  const { data: messages, error: msgError } = await admin
    .from('messages')
    .select('id,sender,content,created_at,tool_calls')
    .eq('conversation_id', conversation.id)
    .order('created_at', { ascending: true });

  if (msgError) {
    console.error(`[backfill] Failed to load messages for conversation ${conversation.id}:`, msgError);
    return {
      updated: false,
      wouldUpdate: false,
      inferredNode: null,
      beforeCurrentNodeId: null,
      beforePendingNodeId: null,
      beforePendingReply: null,
    };
  }

  const runtimeState = await loadLeadRuntimeState(admin, conversation.lead_id);
  const inferredNode = inferCurrentNodeIdFromMessages(messages || [], funnelFlow, {
    currentFunnelStep: conversation.current_funnel_step,
    currentNodeId: runtimeState.currentNodeId,
    pendingNodeId: runtimeState.pendingNodeId,
  });
  if (!inferredNode) {
    console.log(`[backfill] No usable history for conversation ${conversation.id}; skipping backfill`);
    return {
      updated: false,
      wouldUpdate: false,
      inferredNode: null,
      beforeCurrentNodeId: null,
      beforePendingNodeId: null,
      beforePendingReply: null,
    };
  }

  console.log(`[backfill] Inferred node from ${messages?.length ?? 0} messages: ${inferredNode}`);

  const wouldUpdateConversation = !conversation.current_funnel_step || conversation.current_funnel_step !== inferredNode;
  const wouldUpdateLeadNode = !runtimeState.currentNodeId || runtimeState.currentNodeId !== inferredNode;
  const wouldUpdate = wouldUpdateConversation || wouldUpdateLeadNode;

  if (dryRun) {
    return {
      updated: false,
      wouldUpdate,
      inferredNode,
      beforeCurrentNodeId: runtimeState.currentNodeId,
      beforePendingNodeId: runtimeState.pendingNodeId,
      beforePendingReply: runtimeState.pendingReply,
    };
  }

  let updated = false;
  if (wouldUpdateConversation) {
    const { error: updateError } = await admin
      .from('conversations')
      .update({ current_funnel_step: inferredNode })
      .eq('id', conversation.id);

    if (updateError) {
      console.error(`[backfill] Failed to update conversation ${conversation.id}:`, updateError);
      return {
        updated: false,
        wouldUpdate: false,
        inferredNode,
        beforeCurrentNodeId: runtimeState.currentNodeId,
        beforePendingNodeId: runtimeState.pendingNodeId,
        beforePendingReply: runtimeState.pendingReply,
      };
    }

    updated = true;
  }

  if (wouldUpdateLeadNode) {
    const { error: leadUpdateError } = await admin
      .from('leads')
      .update({
        attributes: {
          ...runtimeState.attributes,
          current_node_id: inferredNode,
        },
      })
      .eq('id', conversation.lead_id);

    if (leadUpdateError) {
      console.error(`[backfill] Failed to update lead ${conversation.lead_id}:`, leadUpdateError);
      return {
        updated: false,
        wouldUpdate: false,
        inferredNode,
        beforeCurrentNodeId: runtimeState.currentNodeId,
        beforePendingNodeId: runtimeState.pendingNodeId,
        beforePendingReply: runtimeState.pendingReply,
      };
    }

    updated = true;
  }

  if (!updated) {
    console.log(`[backfill] ✓ Conversation ${conversation.id} already had matching funnel state`);
    return {
      updated: false,
      wouldUpdate: false,
      inferredNode,
      beforeCurrentNodeId: runtimeState.currentNodeId,
      beforePendingNodeId: runtimeState.pendingNodeId,
      beforePendingReply: runtimeState.pendingReply,
    };
  }

  console.log(`[backfill] ✓ Updated conversation ${conversation.id} → node=${inferredNode}`);

  await admin.from('notification_log').insert({
    agent_id: conversation.agent_id,
    lead_id: conversation.lead_id,
    notification_type: 'backfill_dialogue_state',
    status: 'sent',
    metadata: {
      conversation_id: conversation.id,
      inferred_node: inferredNode,
      message_count: messages?.length || 0,
      backfill_reason: 'restore_incomplete_dialogue_context'
    },
    created_at: new Date().toISOString()
  });

  return {
    updated: true,
    wouldUpdate: true,
    inferredNode,
    beforeCurrentNodeId: runtimeState.currentNodeId,
    beforePendingNodeId: runtimeState.pendingNodeId,
    beforePendingReply: runtimeState.pendingReply,
  };
}

async function main() {
  const admin = createAdminClient();
  const cliArgs = parseCliArgs(process.argv.slice(2));

  console.log('=== Backfill Dialogue State Script ===');
  console.log(`Mode: ${cliArgs.dryRun ? 'dry-run' : 'apply'}`);

  if (cliArgs.conversationIds.length > 0) {
    console.log(`Target conversations: ${cliArgs.conversationIds.join(', ')}`);
  } else {
    console.log('Loading conversations with missing current_funnel_step...\n');
  }

  let conversationsQuery = admin
    .from('conversations')
    .select('id,lead_id,agent_id,current_funnel_step');

  if (cliArgs.conversationIds.length > 0) {
    conversationsQuery = conversationsQuery.in('id', cliArgs.conversationIds);
  } else {
    conversationsQuery = conversationsQuery.is('current_funnel_step', null);
  }

  const { data: conversationsData, error: convError } = await conversationsQuery;

  if (convError) {
    console.error('Failed to load conversations:', convError);
    process.exit(1);
  }

  const conversations: ConversationRecord[] = conversationsData || [];
  console.log(`Found ${conversations.length} conversations${cliArgs.conversationIds.length > 0 ? ' for requested ids' : ' with missing current_funnel_step'}\n`);

  if (conversations.length === 0) {
    console.log('✓ No backfill needed — no matching conversations found');
    process.exit(0);
  }

  const convsByAgentId = new Map<string, ConversationRecord[]>();
  for (const conv of conversations) {
    if (!convsByAgentId.has(conv.agent_id)) {
      convsByAgentId.set(conv.agent_id, []);
    }
    convsByAgentId.get(conv.agent_id)!.push(conv);
  }

  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalWouldUpdate = 0;

  for (const [agentId, agentConversations] of convsByAgentId) {
    const { data: agentData, error: agentError } = await admin
      .from('agents')
      .select('id,name,dialogue_flow')
      .eq('id', agentId)
      .maybeSingle();

    if (agentError || !agentData) {
      console.error(`[backfill] Failed to load agent ${agentId}:`, agentError);
      totalSkipped += agentConversations.length;
      continue;
    }

    let funnelFlow;
    try {
      funnelFlow = normalizeFunnelFlow(agentData.dialogue_flow);
      if (!funnelFlow) {
        console.error(`[backfill] Funnel normalize returned null for agent ${agentId}`);
        totalSkipped += agentConversations.length;
        continue;
      }
    } catch (err) {
      console.error(`[backfill] Failed to normalize funnel for agent ${agentId}:`, err);
      totalSkipped += agentConversations.length;
      continue;
    }

    console.log(`[backfill] Agent "${agentData.name}" (entry=${funnelFlow.entryNodeId})`);

    for (const conv of agentConversations) {
      const result = await backfillConversation(admin, conv, funnelFlow, cliArgs.dryRun);
      if (cliArgs.dryRun) {
        if (result.wouldUpdate) {
          totalWouldUpdate += 1;
        } else {
          totalSkipped += 1;
        }

        console.log(`[dry-run] conversation=${conv.id}`);
        console.log(`  current_funnel_step=${conv.current_funnel_step ?? 'null'} -> ${result.wouldUpdate ? (result.inferredNode ?? 'unchanged') : 'unchanged'}`);
        console.log(`  current_node_id=${result.beforeCurrentNodeId ?? 'null'} -> ${result.wouldUpdate ? (result.inferredNode ?? 'unchanged') : 'unchanged'}`);
        console.log(`  pending_script_node_id=${result.beforePendingNodeId ?? 'null'} -> ${result.beforePendingNodeId ?? 'null'}`);
        console.log(`  pending_script_reply=${result.beforePendingReply ?? 'null'} -> ${result.beforePendingReply ?? 'null'}`);
      } else if (result.updated) {
        totalUpdated += 1;
      } else {
        totalSkipped += 1;
      }
    }
  }

  if (cliArgs.dryRun) {
    console.log(`\n=== Dry Run Complete ===`);
    console.log(`✓ Would update: ${totalWouldUpdate}`);
    console.log(`⊘ No change: ${totalSkipped}`);
    process.exit(0);
  }

  console.log(`\n=== Backfill Complete ===`);
  console.log(`✓ Updated: ${totalUpdated}`);
  console.log(`⊘ Skipped: ${totalSkipped}`);

  if (totalUpdated > 0) {
    console.log(`\n✓ Backfilled ${totalUpdated} conversations. Leads can now resume from correct funnel nodes.`);
  }

  process.exit(totalUpdated > 0 ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
