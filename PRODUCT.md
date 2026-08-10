# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary users are public visitors who need to confirm whether the configured
services are currently available and understand their recent reliability. The
product has no public or private administration interface.

## Product Purpose

Provide a public, read-only service status page backed by automated Cloudflare
Worker checks. A visitor should be able to understand the overall state, the
state of each service, recent response latency, and historical incidents without
signing in.

Success means preserving the original project's focused feature set while
modernizing its runtime, storage, reliability, testability, and presentation.

## Positioning

The product is a small, self-hosted, configuration-as-code status page that runs
entirely on the Cloudflare Developer Platform. Monitoring targets, thresholds,
site identity, and the deployed visual theme are selected in configuration and
take effect on deployment; there is no management application to operate.

## Operating Context

- A Cloudflare Cron Trigger runs checks at a configured interval, with one-minute,
  five-minute, and ten-minute schedules supported.
- Public visitors use a responsive web page to read current and historical state.
- The owner changes monitor definitions, site identity, thresholds, and the
  default theme in private build configuration, then redeploys. The public
  repository contains sanitized examples only.
- D1 is the structured data store. New installations initialize its schema from
  the SQL files in `database/` before the first deployment.
- Routine checks update the current monitor state and compact daily aggregates.
  Only incident state changes are retained as explicit start, escalation, and
  recovery timestamps; per-check raw rows are intentionally not stored.

## Capabilities and Constraints

- Preserve the original product scope: overall status, per-service status,
  90-day history, latest check time and location, response latency, service
  search, light/dark-aware presentation where supported by a theme, and
  Slack, Telegram, and Discord status-change notifications.
- Publicly display incident start and recovery history in addition to the
  information already represented by the original project. This is a clearer
  representation of the existing monitoring data, not an administration feature.
- Store current monitor state, compact daily summaries, and incident periods;
  do not create a new D1 row for every scheduled check.
- Model three public states: operational (green), degraded (yellow), and outage
  (red).
- Global threshold defaults are configurable and may be overridden per monitor.
  The defaults are two consecutive failures to enter degraded, 60 minutes from
  the first failure to enter outage, and two consecutive successes to recover.
- Entering degraded creates one incident and sends a failure notification.
  Escalating the same incident to outage does not send another notification.
  Recovery closes the incident and sends a recovery notification.
- A failed check resets consecutive successes; a successful check resets
  consecutive failures according to the state machine. Unchanged states do not
  create duplicate incidents or notifications.
- The page is public and read-only. Authentication, an admin dashboard, editing,
  and runtime theme selection are explicitly out of scope.
- The implementation must remain economical at a one-minute schedule for the
  current small monitor set and read only bounded state, summaries, and incidents.

## Brand Commitments

- Site title, logo, public URL, and monitor content are configuration values, not
  a fixed brand identity.
- Themes control presentation without changing factual status content, service
  names, thresholds, or monitoring behavior.
- The project must support a repository of deploy-time themes, including a modern
  default theme and a Stardew Valley-inspired theme.
- Monitor presentation may optionally reference a configured logo or icon asset.
  Themes may frame or restyle that asset, but the asset never changes monitoring
  identity or behavior and must have a clear fallback when absent.
- Deploy-time theme selection is separate from color mode. The active theme may
  provide a public light/dark mode toggle without exposing a runtime theme-pack
  selector.
- The default theme is intentionally minimal: modern cards, fluid purposeful
  motion, and complete light/dark modes, with no ornamental visual concept.
  Linear's motion refinement, Vercel's light/dark discipline, and Apple's
  information restraint are its confirmed craft benchmarks.
- The Stardew Valley-inspired theme is an original rural pixel-art homage. It
  combines a complete farmhouse day/night scene with paper service cards,
  illustrated wood frames, and original pixel icon containers. It must not copy
  the game's logo, characters, sprites, interface panels, typeface, or audio.

## Evidence on Hand

- The legacy product implementation and public content are present in
  `pages/index.js`, `src/components/`, and `src/functions/`.
- Current monitor and site configuration is present in `config.yaml`.
- Existing logo and favicon assets are present in `public/`.
- The legacy KV schema and aggregation behavior are present in
  `src/functions/cronTrigger.js` and `src/functions/helpers.js`.
- No user research, testimonials, availability guarantees, customer claims, or
  commercial claims are available and none should be fabricated.

## Product Principles

1. Make current service health unmistakable before presenting detail.
2. Preserve monitoring truth across every theme; decoration never changes meaning.
3. Keep operation configuration-driven and deployment-based rather than adding
   management UI.
4. Record enough structured history to explain incidents without making routine
   page loads expensive.
5. Treat transient network failures carefully so public state and notifications
   remain trustworthy.
