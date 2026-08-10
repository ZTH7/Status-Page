# Release-candidate verification

Verified locally on 2026-08-08. This record covers this standalone Status Page
project only. It does not claim a production deployment, remote D1 schema
initialization, live Cron execution, external notification delivery, or
custom-domain cutover.

## Automated evidence

- `npm run check`: passed after all implementation and documentation changes.
  Formatting and TypeScript checks emitted no errors; 72 unit, 62 frontend,
  and 77 Worker/D1 tests passed (211 total); the default production build
  completed successfully.
- Default production bundle: client CSS 16.12 KB (3.92 KB gzip), JavaScript
  206.10 KB (64.65 KB gzip); the client animation dependency is no longer
  included, and no Pixelify font or farm background is emitted.
- `npm run db:init:local`: initialized the local D1 schema from `database/`.
- `npx wrangler deploy --dry-run`: compiled the Worker with the account-neutral
  `DB` binding and recognized `status-page` as a D1 resource without a database
  ID. No remote resource was created or changed.
- Impeccable detection identified two history-bar height transitions; both were
  replaced by compositor-friendly transforms. Its remaining generic Geist-font
  warning was intentionally not applied because Geist is pinned by `DESIGN.md`.

The cross-layer timeline processes six checks against real local D1 and reads
the public API after each transition: success, first failure, second failure,
60-minute outage, first recovery success, and second recovery success. It
proves one failure notification, no outage-escalation notification, one recovery
notification, one incident ID, outage daily maximum, and API state agreement.
Separate persistence and scheduled-handler tests prove that duplicate or stale
runs do not increment daily aggregates, mutate incidents, or send notifications.
Notification tests also verify 25 simultaneous actions are split within Telegram
and Discord platform limits.

## Theme and UI limits

Both themes were statically inspected, contract-tested, typechecked, and built.
The four generated rural source images were visually inspected at original
resolution before integration. The in-app browser runtime exposed no usable
browser instance in this environment, so a live 1440×900 / 834×1112 / 390×844
screenshot matrix was not captured. Browser QA remains an operator preview gate
before production cutover; the exact preview procedure is in
`docs/operations.md`.

## Remaining authorized-operator actions

Configure both private build-time YAML documents, run the Cloudflare deployment
that provisions D1 and applies `database/schema.sql`, verify the production UI
and API, observe scheduled successes, add only the intended notification
secrets, and change the custom-domain route. Follow `docs/operations.md` in
order.
