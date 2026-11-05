# Explicit read-only bot sharing

## Scope

A registered Space member can read a bot owned by another member only when an
administrator explicitly adds a `(botId, userId)` grant to `bot_readers`.
Membership alone does not expose any bots. This implementation does not provide
an invitation or grant-management UI.

The web and Electron sidebar lists granted bots with a read-only label. Opening
one uses a dedicated reader, not the owner's interactive chat. Native mobile
does not list grants yet; existing native ownership checks remain unchanged.

## Security boundary

- Every list and message request checks current Space membership.
- Every message request checks the explicit grant, selected Space, and active bot.
- Only user and bot conversation text is returned. Tool payloads, attachments,
  approvals, settings, and credentials are not exposed by these endpoints.
- Conversation text itself can contain sensitive material: grant it deliberately.
- The fixed read runs in the bot owner's tenant context after authorization.
  The owner's identity is never substituted into a caller's writable request.
- Existing bot, thread, message, run, and action endpoints retain ownership checks.
- Removing a grant prevents subsequent reads, but cannot erase previously read data.

## Reading and refresh

The reader fetches the latest 100 stored messages every two seconds while visible.
This is polling, not token-by-token streaming. Older pages are available using a
sequence cursor; viewing an older page pauses polling. Return to Latest messages
to resume. Text is rendered as plain text, not interpreted HTML or Markdown.

## Deployment

Repository root: `<repository>`; keep all private values outside tracked files.

1. Generate the Prisma client and run the tests and type checks below.
2. Build the shared application image once. API and web use the same Dockerfile.
3. Apply the additive `20261105180000_bot_readers` migration before updating API.
   It creates a grant table and foreign keys; existing releases remain compatible.
4. Update API and web without restarting unrelated services or deleting volumes.
5. Resolve the intended bot, owner, reader, and Space from the database. Verify
   current membership before inserting the grant. Never grant by bot name alone.
6. Verify with the actual application database role that the reader lists and
   reads the bot, another bot remains inaccessible, and normal write lookups fail.
7. Reload the reader's browser, select the shared Space, then open the read-only bot.

Revocation is a deletion of the exact pair from `bot_readers`; it needs no restart.
No passwords, session tokens, or account impersonation are needed to create a grant.

## Validation commands

Run from `<repository>`, in PowerShell, one command at a time:

```powershell
pnpm --filter @rakazo/db generate
pnpm exec vitest run packages/db/src/bot-readers.test.ts
pnpm --filter @rakazo/db check
pnpm --filter @rakazo/api check
pnpm --filter @rakazo/web check
git --no-pager diff --check
```

Unit coverage includes missing/revoked membership, missing/revoked grants,
Space/owner/archive filtering, text-only output, pagination, and tenant-context
restoration. Mock tests do not replace a live database permission check or a
browser check. Do not claim deployment or end-to-end verification from unit tests.