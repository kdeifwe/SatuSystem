import test from 'node:test';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { markSmartBroadcastReplied } from '../lib/smart-broadcasts/service';

// Load env from .env.local
dotenv.config({ path: '.env.local' });

// Integration test: real Supabase database
// This tests that when a lead responds to a smart broadcast message,
// the recipient is marked as replied with the correct timestamp

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Create a service client for tests
function getTestClient() {
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

test('markSmartBroadcastReplied marks recipients as replied on first response', async () => {
  const supabase = getTestClient();

  // Setup: Create test org, agent, lead, campaign, recipient with status='sent'
  const testId = `test-${Date.now()}`;
  const orgName = `test-org-${testId}`;
  const leadName = `test-lead-${testId}`;

  try {
    // Create org
    const { data: orgData, error: orgError } = await supabase
      .from('organizations')
      .insert({ name: orgName })
      .select('id')
      .single();
    assert(!orgError, `Failed to create test org: ${orgError?.message}`);
    const orgId = orgData.id;

    // Create agent
    const { data: agentData, error: agentError } = await supabase
      .from('agents')
      .insert({
        org_id: orgId,
        name: `test-agent-${testId}`,
        role: 'Test Agent',
        is_active: true,
        system_prompt_compiled: 'Test prompt',
      })
      .select('id')
      .single();
    assert(!agentError, `Failed to create test agent: ${agentError?.message}`);
    const agentId = agentData.id;

    // Create lead
    const { data: leadData, error: leadError } = await supabase
      .from('leads')
      .insert({
        org_id: orgId,
        name: leadName,
        external_id: `lead-ext-${testId}`,
        status: 'active',
        ai_enabled: true,
      })
      .select('id')
      .single();
    assert(!leadError, `Failed to create test lead: ${leadError?.message}`);
    const leadId = leadData.id;

    // Create signal
    const { data: signalData, error: signalError } = await supabase
      .from('lead_signals')
      .insert({
        org_id: orgId,
        lead_id: leadId,
        signal_type: 'awaiting_funds',
        description: 'Waiting for salary',
        raw_quote: 'Will buy after salary arrives',
        status: 'active',
      })
      .select('id')
      .single();
    assert(!signalError, `Failed to create test signal: ${signalError?.message}`);
    const signalId = signalData.id;

    // Create campaign
    const { data: campaignData, error: campaignError } = await supabase
      .from('smart_campaigns')
      .insert({
        org_id: orgId,
        name: `test-campaign-${testId}`,
        goal_instruction: 'Ask about salary',
        audience_filter: { signal_types: ['awaiting_funds'] },
        requires_approval: true,
        max_message_length: 160,
      })
      .select('id')
      .single();
    assert(!campaignError, `Failed to create test campaign: ${campaignError?.message}`);
    const campaignId = campaignData.id;

    // Create recipient with status='sent'
    const { data: recipientData, error: recipientError } = await supabase
      .from('smart_campaign_recipients')
      .insert({
        campaign_id: campaignId,
        lead_id: leadId,
        signal_id: signalId,
        status: 'sent',
        generated_message: 'Have you received your salary?',
        sent_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    assert(!recipientError, `Failed to create test recipient: ${recipientError?.message}`);
    const recipientId = recipientData.id;

    // Verify initial state: status='sent', replied_at is null
    const { data: initialRecipient } = await supabase
      .from('smart_campaign_recipients')
      .select('id, status, replied_at')
      .eq('id', recipientId)
      .single();
    assert.equal(initialRecipient.status, 'sent');
    assert.equal(initialRecipient.replied_at, null);

    // Call markSmartBroadcastReplied
    const markedCount = await markSmartBroadcastReplied(leadId, orgId);
    assert.equal(markedCount, 1, 'Should mark exactly one recipient as replied');

    // Verify post-state: status='replied', replied_at is set
    const { data: updatedRecipient } = await supabase
      .from('smart_campaign_recipients')
      .select('id, status, replied_at')
      .eq('id', recipientId)
      .single();
    assert.equal(updatedRecipient.status, 'replied', 'Recipient should be marked as replied');
    assert.notEqual(updatedRecipient.replied_at, null, 'replied_at should be set');

    const repliedTime = new Date(updatedRecipient.replied_at);
    const now = new Date();
    const timeDiff = Math.abs(now.getTime() - repliedTime.getTime());
    assert.ok(timeDiff < 5000, 'replied_at should be very recent (within 5 seconds)');

    console.log(`[✓] First response marked recipient as replied in ${timeDiff}ms`);
  } finally {
    // Cleanup: delete test data
    if (supabaseUrl && supabaseServiceKey) {
      // Clean up in reverse dependency order
      const { data: testOrgs } = await supabase
        .from('organizations')
        .select('id')
        .like('name', `%${testId}%`);

      if (testOrgs && testOrgs.length > 0) {
        const testOrgId = testOrgs[0].id;

        // Delete cascade will handle related records
        await supabase.from('organizations').delete().eq('id', testOrgId);
      }
    }
  }
});

test('markSmartBroadcastReplied is idempotent (second call does not re-update)', async () => {
  const supabase = getTestClient();

  const testId = `test-idempotent-${Date.now()}`;
  const orgName = `test-org-${testId}`;

  try {
    // Setup same as above
    const { data: orgData } = await supabase
      .from('organizations')
      .insert({ name: orgName })
      .select('id')
      .single();
    const orgId = orgData.id;

    const { data: agentData } = await supabase
      .from('agents')
      .insert({
        org_id: orgId,
        name: `test-agent-${testId}`,
        role: 'Test Agent',
        is_active: true,
        system_prompt_compiled: 'Test prompt',
      })
      .select('id')
      .single();

    const { data: leadData } = await supabase
      .from('leads')
      .insert({
        org_id: orgId,
        name: `test-lead-${testId}`,
        external_id: `lead-ext-${testId}`,
        status: 'active',
        ai_enabled: true,
      })
      .select('id')
      .single();
    const leadId = leadData.id;

    const { data: signalData } = await supabase
      .from('lead_signals')
      .insert({
        org_id: orgId,
        lead_id: leadId,
        signal_type: 'awaiting_funds',
        description: 'Waiting for salary',
        raw_quote: 'Will buy after salary',
        status: 'active',
      })
      .select('id')
      .single();
    const signalId = signalData.id;

    const { data: campaignData } = await supabase
      .from('smart_campaigns')
      .insert({
        org_id: orgId,
        name: `test-campaign-${testId}`,
        goal_instruction: 'Ask about salary',
        audience_filter: { signal_types: ['awaiting_funds'] },
        requires_approval: true,
        max_message_length: 160,
      })
      .select('id')
      .single();
    const campaignId = campaignData.id;

    const { data: recipientData } = await supabase
      .from('smart_campaign_recipients')
      .insert({
        campaign_id: campaignId,
        lead_id: leadId,
        signal_id: signalId,
        status: 'sent',
        generated_message: 'Have you received your salary?',
        sent_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    const recipientId = recipientData.id;

    // First call
    const count1 = await markSmartBroadcastReplied(leadId, orgId);
    assert.equal(count1, 1);

    const { data: afterFirst } = await supabase
      .from('smart_campaign_recipients')
      .select('replied_at')
      .eq('id', recipientId)
      .single();
    const firstRepliedAt = afterFirst.replied_at;

    // Small delay to ensure timestamps would differ if updated
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Second call (idempotent)
    const count2 = await markSmartBroadcastReplied(leadId, orgId);
    assert.equal(count2, 0, 'Second call should not update any recipients');

    const { data: afterSecond } = await supabase
      .from('smart_campaign_recipients')
      .select('replied_at')
      .eq('id', recipientId)
      .single();
    const secondRepliedAt = afterSecond.replied_at;

    assert.equal(
      firstRepliedAt,
      secondRepliedAt,
      'replied_at should remain the same after second idempotent call'
    );

    console.log(`[✓] Idempotent call verified: second call returned 0 updates`);
  } finally {
    // Cleanup
    if (supabaseUrl && supabaseServiceKey) {
      const { data: testOrgs } = await supabase
        .from('organizations')
        .select('id')
        .like('name', `%${testId}%`);

      if (testOrgs && testOrgs.length > 0) {
        const testOrgId = testOrgs[0].id;
        await supabase.from('organizations').delete().eq('id', testOrgId);
      }
    }
  }
});

test('markSmartBroadcastReplied handles race condition: marks both sent and sending statuses', async () => {
  const supabase = getTestClient();

  const testId = `test-race-${Date.now()}`;
  const orgName = `test-org-${testId}`;

  try {
    // Setup
    const { data: orgData } = await supabase
      .from('organizations')
      .insert({ name: orgName })
      .select('id')
      .single();
    const orgId = orgData.id;

    const { data: agentData } = await supabase
      .from('agents')
      .insert({
        org_id: orgId,
        name: `test-agent-${testId}`,
        role: 'Test Agent',
        is_active: true,
        system_prompt_compiled: 'Test prompt',
      })
      .select('id')
      .single();

    const { data: leadData } = await supabase
      .from('leads')
      .insert({
        org_id: orgId,
        name: `test-lead-${testId}`,
        external_id: `lead-ext-${testId}`,
        status: 'active',
        ai_enabled: true,
      })
      .select('id')
      .single();
    const leadId = leadData.id;

    const { data: signalData } = await supabase
      .from('lead_signals')
      .insert({
        org_id: orgId,
        lead_id: leadId,
        signal_type: 'awaiting_funds',
        description: 'Waiting for salary',
        raw_quote: 'Will buy after salary',
        status: 'active',
      })
      .select('id')
      .single();
    const signalId = signalData.id;

    // Create TWO campaigns to avoid unique constraint on (campaign_id, lead_id)
    const { data: campaign1Data } = await supabase
      .from('smart_campaigns')
      .insert({
        org_id: orgId,
        name: `test-campaign1-${testId}`,
        goal_instruction: 'Ask about salary',
        audience_filter: { signal_types: ['awaiting_funds'] },
        requires_approval: true,
        max_message_length: 160,
      })
      .select('id')
      .single();
    const campaign1Id = campaign1Data.id;

    const { data: campaign2Data } = await supabase
      .from('smart_campaigns')
      .insert({
        org_id: orgId,
        name: `test-campaign2-${testId}`,
        goal_instruction: 'Follow up on salary',
        audience_filter: { signal_types: ['awaiting_funds'] },
        requires_approval: true,
        max_message_length: 160,
      })
      .select('id')
      .single();
    const campaign2Id = campaign2Data.id;

    // Create recipient 1 with status='sent' in campaign 1
    const { data: recipient1Data } = await supabase
      .from('smart_campaign_recipients')
      .insert({
        campaign_id: campaign1Id,
        lead_id: leadId,
        signal_id: signalId,
        status: 'sent',
        generated_message: 'Message 1',
        sent_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    // Create recipient 2 with status='sending' in campaign 2 (simulating race condition)
    const { data: recipient2Data } = await supabase
      .from('smart_campaign_recipients')
      .insert({
        campaign_id: campaign2Id,
        lead_id: leadId,
        signal_id: signalId,
        status: 'sending',
        generated_message: 'Message 2',
      })
      .select('id')
      .single();

    // Call markSmartBroadcastReplied
    const markedCount = await markSmartBroadcastReplied(leadId, orgId);
    assert.equal(markedCount, 2, 'Should mark both sent and sending recipients');

    // Verify both are marked as replied
    const { data: allRecipients } = await supabase
      .from('smart_campaign_recipients')
      .select('id, status, replied_at')
      .eq('lead_id', leadId);

    assert.equal(allRecipients.length, 2);
    allRecipients.forEach((r) => {
      assert.equal(r.status, 'replied', `Recipient ${r.id} should be marked as replied`);
      assert.notEqual(r.replied_at, null, `Recipient ${r.id} should have replied_at set`);
    });

    console.log(`[✓] Race condition handling verified: both sent and sending statuses marked as replied`);
  } finally {
    // Cleanup
    if (supabaseUrl && supabaseServiceKey) {
      const { data: testOrgs } = await supabase
        .from('organizations')
        .select('id')
        .like('name', `%${testId}%`);

      if (testOrgs && testOrgs.length > 0) {
        const testOrgId = testOrgs[0].id;
        await supabase.from('organizations').delete().eq('id', testOrgId);
      }
    }
  }
});

test('markSmartBroadcastReplied respects org_id boundary (defense-in-depth)', async () => {
  const supabase = getTestClient();

  const testId = `test-org-boundary-${Date.now()}`;

  try {
    // Create two separate test orgs
    const { data: org1Data } = await supabase
      .from('organizations')
      .insert({ name: `test-org1-${testId}` })
      .select('id')
      .single();
    const org1Id = org1Data.id;

    const { data: org2Data } = await supabase
      .from('organizations')
      .insert({ name: `test-org2-${testId}` })
      .select('id')
      .single();
    const org2Id = org2Data.id;

    // Create lead in org1
    const { data: leadData } = await supabase
      .from('leads')
      .insert({
        org_id: org1Id,
        name: `test-lead-${testId}`,
        external_id: `lead-ext-${testId}`,
        status: 'active',
      })
      .select('id')
      .single();
    const leadId = leadData.id;

    // Create signal in org1
    const { data: signalData } = await supabase
      .from('lead_signals')
      .insert({
        org_id: org1Id,
        lead_id: leadId,
        signal_type: 'awaiting_funds',
        description: 'Test',
        status: 'active',
      })
      .select('id')
      .single();
    const signalId = signalData.id;

    // Create campaign in org2 (different org!)
    const { data: campaignData } = await supabase
      .from('smart_campaigns')
      .insert({
        org_id: org2Id,
        name: `test-campaign-${testId}`,
        goal_instruction: 'Test',
        audience_filter: {},
        requires_approval: true,
      })
      .select('id')
      .single();
    const campaignId = campaignData.id;

    // Try to create recipient linking org2 campaign to org1 lead (this should not normally happen)
    // But if it did, markSmartBroadcastReplied should NOT mark it because org_id doesn't match
    const { data: recipientData } = await supabase
      .from('smart_campaign_recipients')
      .insert({
        campaign_id: campaignId,
        lead_id: leadId,
        signal_id: signalId,
        status: 'sent',
        generated_message: 'Test message',
      })
      .select('id')
      .single();
    const recipientId = recipientData.id;

    // Call markSmartBroadcastReplied with org1Id (lead's org)
    const markedCount = await markSmartBroadcastReplied(leadId, org1Id);
    // Should be 0 because campaign belongs to org2
    assert.equal(markedCount, 0, 'Should not mark recipients from different org');

    // Verify recipient is still in 'sent' status
    const { data: unchanged } = await supabase
      .from('smart_campaign_recipients')
      .select('status, replied_at')
      .eq('id', recipientId)
      .single();
    assert.equal(unchanged.status, 'sent', 'Status should remain sent');
    assert.equal(unchanged.replied_at, null, 'replied_at should remain null');

    console.log(`[✓] Org boundary defense-in-depth verified: cross-org update prevented`);
  } finally {
    // Cleanup
    if (supabaseUrl && supabaseServiceKey) {
      const { data: testOrgs } = await supabase
        .from('organizations')
        .select('id')
        .like('name', `%${testId}%`);

      if (testOrgs) {
        for (const org of testOrgs) {
          await supabase.from('organizations').delete().eq('id', org.id);
        }
      }
    }
  }
});
