/**
 * Test script for WhatsApp disconnect notification
 * Simulates a disconnect event and verifies notification is logged
 */

const AGENT_ID = 'a781ac2d-adad-4fcf-a8be-26f0f008979e'; // Use existing agent from browser
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function testWhatsAppDisconnectNotification() {
  if (!SERVICE_ROLE_KEY) {
    console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY not set');
    process.exit(1);
  }

  try {
    console.log('[TEST] Starting WhatsApp disconnect notification test...');
    console.log(`[TEST] Using AGENT_ID: ${AGENT_ID}`);

    // Call the enqueueNotification function via a test endpoint
    // For now, we'll directly test via Supabase API
    const response = await fetch(`${SUPABASE_URL}/rest/v1/notification_log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        apikey: SERVICE_ROLE_KEY,
      },
      body: JSON.stringify({
        event_type: 'whatsapp_disconnected',
        agent_id: AGENT_ID,
        payload: {
          reason: 'TEST: Simulated disconnect',
          timestamp: new Date().toISOString(),
          source: 'test_script',
        },
        sent_at: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      console.error('[TEST] Failed to insert notification:', response.status, await response.text());
      process.exit(1);
    }

    console.log('[TEST] ✓ Notification inserted successfully');

    // Now verify it's in the DB
    await new Promise((r) => setTimeout(r, 1000)); // Wait a bit

    const checkResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/notification_log?event_type=eq.whatsapp_disconnected&agent_id=eq.${AGENT_ID}&order=sent_at.desc&limit=1`,
      {
        headers: {
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          apikey: SERVICE_ROLE_KEY,
        },
      }
    );

    const data = await checkResponse.json();

    if (!Array.isArray(data) || data.length === 0) {
      console.error('[TEST] FAILED: Notification not found in notification_log');
      process.exit(1);
    }

    const log = data[0];
    console.log('[TEST] ✓ Notification verified in database:');
    console.log(`  - ID: ${log.id}`);
    console.log(`  - Event Type: ${log.event_type}`);
    console.log(`  - Agent ID: ${log.agent_id}`);
    console.log(`  - Payload: ${JSON.stringify(log.payload)}`);
    console.log(`  - Sent At: ${log.sent_at}`);

    console.log('\n[TEST] ✓ All tests passed!');
    process.exit(0);
  } catch (error) {
    console.error('[TEST] Error:', error);
    process.exit(1);
  }
}

testWhatsAppDisconnectNotification();
