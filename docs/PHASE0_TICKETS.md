# Phase 0 follow-up tickets

## TICKET-2026-001 — Replace preflight user lookup in invite acceptance

- Problem: [app/api/invites/accept/route.ts](app/api/invites/accept/route.ts) currently uses `admin.auth.admin.listUsers()` to detect an already-registered email before trying to create the user.
- Risk: this is not paginated and can miss older users once the user base grows beyond the first page.
- Scope: switch the duplicate-email handling to rely on the error returned by `admin.auth.admin.createUser()` for duplicate email cases, and return a clear `409` message without preflight listing.
- Status: deferred, not blocker for Phase 0.

## TICKET-2026-002 — Keep invite tokens available for manual owner/admin delivery

- Problem: the invite flow needs a way for an owner/admin to obtain the token so they can manually send it to the invitee by WhatsApp/email.
- Scope: keep the token available to the creating owner/admin through the product UI/API for manual delivery, while planning a separate automated delivery mechanism.
- Status: implemented for the current manual-delivery workflow; not a blocker for Phase 0.

## TICKET-2026-003 — Add a baseline regression check for the three requested tests

- Problem: the earlier baseline comparison against the three targeted tests was not captured as a formal regression checklist item.
- Scope: run the baseline comparison in a clean worktree and record the result for the unified orchestrator, notification system, and funnel-flow tests.
- Status: deferred, not blocker for Phase 0.

## TICKET-2026-004 — Add automated invite delivery (email/WhatsApp)

- Problem: the product can create an invite and hand the token to an owner/admin for manual delivery, but there is no automatic sending path yet.
- Scope: add a real delivery mechanism for invite emails or WhatsApp messages and remove the need for manual copy/paste.
- Status: deferred, not blocker for the current manual invite flow.

## TICKET-2026-005 — Make invite-flow cleanup reliable in Supabase auth

- Problem: [scripts/verify-invite-flow.mjs](scripts/verify-invite-flow.mjs) and [scripts/verify-invite-rls.mjs](scripts/verify-invite-rls.mjs) still need reliable cleanup for test auth users, profiles, org memberships, organizations, and invite rows created during verification runs.
- Scope: investigate the Supabase auth deletion failure, make the cleanup robust for both auth and Postgres artifacts, and document a manual cleanup procedure for the test project when the auth API is flaky.
- Status: deferred, not blocker for Phase 0.
- Note: the current RLS verification script now attempts to remove Postgres test artifacts after each run, but auth-user cleanup may still surface transient `AuthRetryableFetchError`/`500` responses and should remain tracked here.
