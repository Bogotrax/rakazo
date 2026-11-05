# Verification record: allowlisted accounts without email delivery

## Scope and evidence status

This record describes the implementation, automated checks and local deployment performed in
this session. It is a historical verification record, not a claim about the current state of
another installation. Repository-relative paths below identify the relevant sources.
No commit was created during the session. No restore, database reset or migration was performed.

| Evidence | Observed result |
| --- | --- |
| Automated auth tests, normal package command | 6 files, 219 tests passed without `--isolate` |
| Auth TypeScript check | Passed |
| Biome checks on changed TypeScript files | No errors; existing `COPY_TEST_DATABASE` environment-declaration warning in the test config |
| Git whitespace/diff check | Passed |
| Rebuilt API container | Healthy |
| API health, web root and proxied auth session endpoint | HTTP 200 |
| Manual registration/login using the deployed UI | Not performed in this session |

An unauthenticated session endpoint returning HTTP 200 proves reachability, not a working
authenticated session. The deployed UI flow remains a separate manual acceptance check.

## Problem and intended behavior

A nonempty signup allowlist previously required email delivery during password signup and
mailbox verification for unverified sessions even when no email provider was configured.
This prevented allowed accounts from using an installation without outbound email.

For ordinary password authentication, subject to the existing signup, account and policy checks:

| Allowlist | Email provider available | Expected verification behavior |
| --- | --- | --- |
| Empty | No | Password signup/login does not require email verification |
| Nonempty | No | Allowed addresses can register and sign in; other addresses cannot register |
| Nonempty | Yes | Unverified accounts must verify their mailbox before signing in |
| Empty | Yes | Verification does not block ordinary password signup/login |

The ordinary allowlist verification gate is now:

```text
requireEmailVerification = allowlist.length > 0 AND emailProviderIsConfigured
```

In the auth implementation, provider availability is represented by `env.email`, not by
whether an SMTP URL happens to exist. A configured provider that fails to deliver is not
treated as an absent provider and does not bypass verification.
Existing messaging-identity restrictions, SSO exceptions and single-account behavior remain
separate rules; this change does not replace them.

## Implementation map

### `packages/auth/src/index.ts`

- The account-admission check requires mailbox proof for allowlisted addresses only when
  `env.email` is available.
- The request hook no longer rejects allowlisted signup solely because email delivery is
  absent. Signup and sign-in compute the provider-aware verification requirement.
- Auth option overrides remain request-local; the implementation does not mutate shared
  verification options between requests.
- The session-lookup wrapper permits ordinary unverified sessions without a mail provider,
  including the lookup needed by authenticated profile updates.
- The session-create hook applies the same provider-aware verification gate.
- Signup without email delivery leaves `emailVerified` as `false`.

### `packages/auth/src/identity-trust.test.ts`

The regression fixture exercises Better Auth routing and password/session behavior using its
memory adapter. Database persistence and workspace provisioning are mocked; these are not
live PostgreSQL end-to-end tests.

Relevant test names and assertions:

- `lets an allowlisted account sign up and in without delivery, staying unverified`:
  outsider rejection; signup token; `emailVerified: false`; API and HTTP session retrieval;
  `/update-user`; sign-out; fresh password login; no sent emails; workspace bootstrap once.
- `still admits later allowlisted accounts without delivery while refusing others`:
  existing account does not prevent another allowed registration/login; outsider rejection.
- `rejects a session for %s`: direct-hook rejection codes, including
  `REGISTRATION_CLOSED` for the disallowed, unprovisioned address without delivery.
- The obsolete first-account-denied case was removed: its fixture did not enable
  single-account mode, so an existing account was not grounds to reject another allowed one.
- Existing delivery-enabled verification and session-blocking tests remain in place.
- `does not leak request-local verification settings when signup policy changes` uses an
  available provider so policy changes actually toggle the verification requirement.

### `vitest.config.ts`: separate Windows test-runner fix

The normal combined auth run initially failed four tests in `index.test.ts`. Mocked adapter
state leaked between files because the mock-using tests were not assigned to the intended
isolated project. Running with `--isolate` passed all 219 tests.

Root cause: Node's `globSync` returned backslash-separated paths on Windows. Those paths did
not match Vitest's include/exclude patterns as intended. The isolated-file list now normalizes
paths before it is used by either project:

```typescript
.map((file) => file.split(path.sep).join("/"))
```

The shared/isolated project strategy and mock-detection expression were not otherwise changed.
After normalization, the normal package test command passed all 219 tests without an isolation
override. A direct Node assertion also checked forward-slash normalization and recognition of
the identity-trust and password-policy mock files.

### `docs/self-host-accounts.md`

Removed the contradictory claim that allowlisted signup always requires email delivery.
The account-bootstrap procedure is still documented as an option for private provisioning,
not as a requirement for all installations without email.

## Reproduce automated verification

Run each command separately from the repository root in PowerShell:

```powershell
pnpm --filter @rakazo/auth test
pnpm --filter @rakazo/auth check
pnpm exec biome check packages/auth/src/index.ts packages/auth/src/identity-trust.test.ts vitest.config.ts
git --no-pager diff --check
```

Dependencies observed in the checkout: Better Auth 1.7.16 and Vitest 4.1.12.
Test counts describe this checkout at verification time, not a permanent expected count.
The whole repository test suite, native apps and authenticated deployed browser flow were not run.
The previously reported Prisma test errors did not recur in the successful final auth run;
no database reset or schema change was used to resolve them.

Documentation consulted through Context7 for the test-runner fix:

- Library: `/vitest-dev/vitest/v4.1.12`.
- [Include patterns](https://github.com/vitest-dev/vitest/blob/v4.1.12/docs/config/include.md).
- [Exclude patterns](https://github.com/vitest-dev/vitest/blob/v4.1.12/docs/config/exclude.md).
- [Module path conventions](https://github.com/vitest-dev/vitest/blob/v4.1.12/docs/api/advanced/test-module.md).

The Windows reproduction and successful normal test run are the direct evidence for this fix.

## Local deployment performed

The installation was already running the source-checkout Docker Compose stack with the
Postgres host-port overlay. No second development server was started.

- Preserved `SIGNUPS_ENABLED=true`, the existing two-address allowlist and existing origins.
- Changed only `EMAIL_PROVIDER` from empty to `none` in the local, untracked `.env`.
- Confirmed that SMTP was not configured before the change.
- Built and recreated only the API service. Other running services and data volumes remained.
- Used `--no-deps` so migration/init services were not rerun.

Equivalent commands, run separately from the repository root:

```powershell
docker compose --env-file .env -f infra/compose/docker-compose.yml -f infra/compose/docker-compose.postgres-host.yml build api
docker compose --env-file .env -f infra/compose/docker-compose.yml -f infra/compose/docker-compose.postgres-host.yml up -d --no-deps --wait api
```

The shared Dockerfile also builds worker/web artifacts while building the API image; this does
not mean the running worker or web containers were replaced.
These commands assume the existing database and schema are already initialized and compatible.
They are not instructions for first-time installation or for skipping future required migrations.

After deployment, checked the running API environment: email provider `none`, signup enabled,
allowlist entry count two. The container was healthy, and these loopback requests returned 200:

```text
http://127.0.0.1:3100/health
http://127.0.0.1:5173/
http://127.0.0.1:5173/api/auth/get-session
```

Private addresses, external hostnames, passwords and other secret values are intentionally
omitted. Do not dump the full `.env` or resolved Compose configuration into a public report.

## Manual acceptance still required

Use the installation's existing configured HTTPS origin in a private browser window:

1. Register with an unused allowed address and a policy-compliant password. Expect direct login
   without an email-verification gate. If the account already exists, test login instead;
   that alone does not validate registration.
2. Reload the page. Expect the session to remain usable.
3. Change the profile display name. Expect successful persistence.
4. Sign out and sign in again with the password. Expect success.
5. If an unused second allowed address is available, register it. Expect success even with an
   existing account.
6. Attempt registration with a non-allowlisted test address. Expect rejection.

Record actual results separately; do not mark these checks passed based only on unit tests
or the unauthenticated HTTP reachability checks.

## Security boundary

An allowlist without email verification restricts accepted address strings but does not prove
mailbox ownership. Someone who knows an allowed unused address may register it. Keep such an
installation behind an appropriate trusted-access boundary, or configure email delivery when
mailbox proof is required. This change neither sets `emailVerified=true` nor grants server
permissions. Switching on an email provider with a nonempty allowlist restores the ordinary
verification requirement for unverified accounts.