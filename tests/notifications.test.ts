import assert from 'node:assert/strict';
import test from 'node:test';

import { getOrgAdminRecipientProfiles, shouldSendNotification } from '../lib/notifications.ts';

test('shouldSendNotification dedupes kaspi alerts for the same org within the throttle window', async () => {
  const admin = {
    from(table: string) {
      assert.equal(table, 'notification_log');
      return {
        select() {
          return {
            eq() {
              return {
                gt() {
                  return {
                    eq() {
                      return {
                        limit() {
                          return Promise.resolve({ data: [{ id: 'existing' }], error: null });
                        },
                      };
                    },
                    limit() {
                      return Promise.resolve({ data: [{ id: 'existing' }], error: null });
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };

  const canSend = await shouldSendNotification(admin as any, 'kaspi_auth_expired', {}, { orgId: 'org-1' });
  assert.equal(canSend, false);
});

test('getOrgAdminRecipientProfiles only returns owner/admin profiles with telegram chat ids', async () => {
  const admin = {
    from(table: string) {
      if (table === 'org_members') {
        return {
          select() {
            return {
              eq() {
                return {
                  in() {
                    return Promise.resolve({
                      data: [
                        { user_id: 'owner-1', role: 'owner' },
                        { user_id: 'admin-1', role: 'admin' },
                        { user_id: 'member-1', role: 'member' },
                      ],
                      error: null,
                    });
                  },
                };
              },
            };
          },
        };
      }

      if (table === 'profiles') {
        return {
          select() {
            return {
              in() {
                return {
                  not() {
                    return Promise.resolve({
                      data: [{ id: 'owner-1' }, { id: 'admin-1' }],
                      error: null,
                    });
                  },
                };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };

  const recipients = await getOrgAdminRecipientProfiles(admin as any, 'org-1');
  assert.deepEqual(recipients, ['owner-1', 'admin-1']);
});
