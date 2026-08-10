# Status Page Operations Runbook

This guide separates local work from commands that access or mutate a
Cloudflare account. Every command marked **remote mutation** can change the
operator's Cloudflare account. None of those commands were run while this
project documentation was implemented. Review the current Cloudflare
documentation and the exact account/resource selection before each remote
step.

## 1. Prerequisites and configuration

Install Node.js 22 or newer and npm. Wrangler is installed as a project
development dependency. A Cloudflare account and a narrowly scoped API token
are needed only for remote work.

Before building or uploading:

- copy `config/site.example.yaml` and `config/monitors.example.yaml` to their
  ignored non-example names for local work;
- set public site identity, labels, custom User-Agent, thresholds, and the deploy-time
  `default` or `stardew-inspired` theme in the site YAML;
- define monitors in the monitor YAML, keeping private/non-linkable target URLs
  out of operator logs and documentation;
- choose the only Cron expression in `wrangler.jsonc`: `* * * * *` for one
  minute, `*/5 * * * *` for five minutes, or `*/10 * * * *` for ten minutes;
- keep credentials and notification values out of tracked configuration.

Cloudflare Workers Builds and the optional GitHub deploy job read the complete
YAML documents from `STATUS_SITE_CONFIG_YAML` and
`STATUS_MONITORS_CONFIG_YAML`. The example files are safe fallback inputs for
verification in a clean public checkout, not production settings.

Validate the bundled configuration locally:

```bash
npm run config:generate
npm run check
```

## 2. Local setup and checks

These commands affect only the local checkout and local D1 state:

```bash
npm install
npm run config:generate
npm run db:init:local
npm run dev
npm run check
```

## 3. Schedule and state semantics

The selected one-, five-, or ten-minute Cron changes how often checks start; it
does not change the time-based thresholds.

With the configured defaults:

- The first failure starts timing but leaves the public state operational.
- Two consecutive failures create one incident, change the service to
  degraded/yellow, and send one failure notification.
- At 60 elapsed minutes from the first failure, the same incident changes to
  outage/red. No escalation notification is sent.
- A success during failure detection resets consecutive failures. While
  recovering, any failure resets consecutive successes.
- Two consecutive successes close the incident, change the service to
  operational/green, and send one recovery notification.
- Unchanged states do not create duplicate incidents or notifications.

Per-monitor threshold overrides in the monitor YAML take precedence over the
global values in the site YAML.

Each completed check conditionally updates one current-state row and one compact
daily aggregate. D1 does not keep per-check raw rows. Incidents retain the
failure start, optional outage escalation, and recovery timestamps.

## 4. D1 provisioning and schema setup

`database/schema.sql` contains the complete D1 table and index definitions for a
new installation.

`wrangler.jsonc` intentionally declares the `DB` binding without an
account-specific resource ID. Deploy to Cloudflare and current Wrangler releases
provision and bind D1 automatically. The production deploy script uploads the
Worker first and then runs the idempotent schema file against the resulting
binding. The optional GitHub production job performs the same two operations.

The schema command uses `--yes` for non-interactive CI. Review every change to
`database/schema.sql`; automatic execution removes a manual approval gate but
does not make destructive SQL safe.

## 5. Upload a safe preview

Do not add notification secrets yet. Use a Worker/environment where all four
notification bindings are absent so preview and initial scheduled state changes
cannot send an external message.

> **Preview upload — remote mutation:** This uploads a Worker version but does
> not route production traffic.

```bash
npx wrangler versions upload --preview-alias cutover
```

When Preview URLs are enabled, Wrangler returns a public preview URL. Open that
exact URL, verify the UI, and verify its `/api/status` response contains only
the expected public data. Do not treat the preview as proof that Cron Triggers
execute: preview URL requests do not establish scheduled execution. Uploading
or rolling back a Worker version does not version or roll back D1 data.

## 6. Add optional notification secrets

Only channels in use need secrets. Do not add any notification secret until the
preview UI and `/api/status` are correct and production has recorded at least
two real scheduled successes. Until then, keep the bindings absent so preview
and cutover cannot emit external messages.

> **Remote mutation:** Each command prompts for a secret value and changes the
> selected Worker's secret bindings. Do not paste values into the command line.

```bash
npx wrangler secret put SECRET_SLACK_WEBHOOK_URL
npx wrangler secret put SECRET_TELEGRAM_API_TOKEN
npx wrangler secret put SECRET_TELEGRAM_CHAT_ID
npx wrangler secret put SECRET_DISCORD_WEBHOOK_URL
```

## 7. Production deployment and exact cutover order

> **Production deployment — remote mutation:** Run this only after the preview
> gates above pass.

```bash
npm run deploy
```

Use this order without skipping gates:

1. Configure both private build-time YAML documents.
2. Upload a preview while all notification secrets remain absent.
3. Verify the preview UI and `/api/status`.
4. Deploy to production; D1 provisioning and schema setup are automatic.
5. Observe at least two real scheduled successes in D1 and the API/UI.
6. Add only the notification secrets for intended channels.
7. Change the custom-domain route to the new Worker.
8. Observe a complete degraded → outage → recovery threshold cycle, using only
   an operator-controlled canary target or a naturally occurring event. Never
   deliberately disrupt a third-party or production target.

Changing the custom-domain route is also a remote mutation. Use the Cloudflare
Dashboard or an independently reviewed, account-specific procedure; do not
improvise a broad routing command.

## 8. Rollback

Select a previously verified Worker version or deployment and route traffic back
to it. Do not delete, truncate, or overwrite the D1 database during code rollback.

A Worker version rollback changes Worker code and assets only; it does not roll
back D1 schema or data. Diagnose D1 separately and prefer read-only queries
until the cause is understood.

## 9. GitHub Actions and credentials

Every push and pull request runs verification only. Production deployment is
available solely through a manual workflow dispatch whose boolean `deploy`
input must be explicitly set to true. The production job deploys the Worker and
then applies `database/schema.sql` to the bound D1 database.

The deploy job is an optional fallback for Cloudflare Connect Repo. It builds
with private configuration, publishes through Wrangler, and performs the same
idempotent database setup as the primary deployment. Store `STATUS_SITE_CONFIG_YAML`,
`STATUS_MONITORS_CONFIG_YAML`, `CLOUDFLARE_API_TOKEN`, and
`CLOUDFLARE_ACCOUNT_ID` as GitHub repository or production-environment secrets.
Restrict the token to the one target account, the Worker deployment permissions
Wrangler requires, and Account D1 Edit for automatic provisioning and schema
setup. Include only the target zone if route access is required; do not grant
user-management or unrelated zone permissions. Protect the `production` GitHub
environment with the repository's normal reviewer policy.

## 10. Cost and operating notes

Usage depends on monitor count, check interval, request volume, D1 storage and
queries, Worker execution, and notification traffic. Review Cloudflare's live
Workers and D1 pricing and limits before choosing a schedule. No fixed price,
free-tier allowance, or availability guarantee is asserted here.

Relevant Cloudflare documentation:

- [Preview URLs](https://developers.cloudflare.com/workers/versions-and-deployments/preview-urls/)
- [Versions and deployments](https://developers.cloudflare.com/workers/versions-and-deployments/)
- [GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/)
- [Deploy to Cloudflare](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
