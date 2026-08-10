---
version: 1
slug: "src-app-app-tsx"
primary_target: "src/app/App.tsx"
related_targets: []
---

## Scope and mode

- Surface: the single public status route implemented by `src/app/App.tsx`.
- Mode: Operate. A visitor scans current service state and recent reliability;
  there are no management tasks.

## Audience, job, content, and constraints

- Public visitors must understand overall state within seconds, then inspect
  individual services, response latency, 90-day history, last check metadata,
  and incident start/recovery history. Service-name search and the `/` focus
  shortcut are preserved from the original product.
- Preserve the original product scope. Do not add uptime percentages, service
  icons, maintenance tools, support links, or administration controls.
- The selected deploy-time theme may change presentation, but status semantics,
  information order, accessibility, and responsive behavior remain shared.

## Chosen direction and memorable moment

- Direction: Quiet Signal, composition C — a compact header and overall status
  card followed by a single vertical run of broad service cards, then a plain
  incident-history card.
- Each desktop service card keeps identity and status at the start, compact
  response/check metadata in the middle, and the longest possible 90-day strip
  at the end. Mobile cards stack those same regions without hiding data.
- The memorable interaction is restrained physical clarity: a service card lifts
  one small elevation step on hover or keyboard focus while its history remains
  stable and readable. Reduced-motion users receive the same focus state without
  translation.

## Direction contract

- THESIS: Make public health readable in one scan; refuse ornamental dashboards.
- OWN-WORLD: Restrained neutral cards, semantic state color, precise type, and one
  responsive elevation step, with an optional original rural pixel-art skin.
- STORY: Read overall state, scan each service and its 90-day strip, then review
  real incident timing.
- FIRST VIEWPORT: Compact identity, mode toggle, overall status, and search, then
  the first broad service cards with status, latency, check time, and history all
  visible.
- FORM: Single-column broad-card feed, approved composition C; responsive-first
  staging selected during the visual review.

## Unresolved decisions

- None. The optional Stardew Valley-inspired theme combines composition B's
  complete farmhouse day/night environment with composition C's paper cards,
  illustrated wood frames, status components, and original pixel icon holders.
