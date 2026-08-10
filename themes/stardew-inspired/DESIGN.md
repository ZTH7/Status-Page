---
name: Status Page Stardew-Inspired Theme
description: An original rural pixel-art day/night world wrapped around clear paper status cards.
---

# Design System: Status Page Stardew-Inspired Theme

## Overview

**Creative North Star: "The Farmhouse Status Board"**

This optional deploy-time theme is a full original rural pixel-art world, not a
light recoloring of the default theme. A day or night farmhouse landscape frames
the page, while service state remains inside highly legible paper cards mounted
in illustrated wood. The environment comes from the approved B composition; the
cards, status components, and pixel icon containers come from composition C.

The theme is expressive around the page and disciplined inside the data. Original
pixel scenery, crops, lanterns, leaves, and weather details establish place, but
they never alter status meaning or occupy the service-history strip. Day/night
mode changes the full environment and surface lighting while preserving layout.

**Key Characteristics:**

- Original pixel-art farmhouse environment with complete day and night modes.
- Paper service cards in illustrated wood frames.
- Original per-service pixel logo containers with a clear fallback.
- Strong semantic status colors and long, readable 90-day strips.
- Discrete pixel-step hover and mode transitions with reduced-motion behavior.

## Colors

Use a full rural palette around a strictly semantic status core.

### Primary

- **Farmhouse Timber** `#6f4527`: Structural
  frames, headers, and pixel-shadow edges.
- **Ledger Paper** `#fff4d1` / `#eadfbd`: Main card interiors
  in both modes, adjusted for appropriate contrast.

### Secondary

- **Day Sky / Night Sky** `#8dc9dc` / `#182f48`: Full-page
  environmental fields selected by color mode.
- **Lantern Gold** `#f2b84b`: Nighttime environmental
  light only; it does not replace degraded yellow.

### Tertiary

- **Operational Green, Degraded Yellow, Outage Red** `#2f6f3a`, `#8a4f00`,
  `#a3342e`: Reserved for status semantics and
  tuned to remain distinct from the surrounding rural palette.

### Neutral

- **Ink Brown / Night Ink** `#3f2d20` / `#2b2119`: Text and
  dividers with accessible contrast on ledger paper.

**The Signal Survives the Season Rule.** Environmental colors may change between
day and night, but green, yellow, and red retain the same status meaning and remain
visually separable.

## Typography

Use the OFL-licensed `Pixelify Sans Variable` only for short headings, service
names, status labels, compact controls, and fallback logo graphemes. Use
`Geist Variable`, then the system sans stack, for timestamps, response times,
URLs, descriptions, history details, and incident rows. Both are self-hosted;
the Pixelify files are emitted only when this deploy-time theme is active.

## Layout

Inherit the shared Quiet Signal composition exactly: compact header, overall
status card, single-column broad service cards, and incident history. The pixel
environment may frame the container but cannot change information order. Mobile
layouts retain every shared field and switch from the 16:9 environment to an
independently composed 9:16 environment below `45rem` (720px).

Spacing inherits the shared 8/12/16/24px rhythm. The environment is a fixed,
`aria-hidden`, pointer-inert decoration beneath the shared application shell;
it never participates in content measurement or focus order.

## Elevation & Depth

Depth is expressed with crisp `4px 4px 0` and raised `6px 6px 0` pixel-shadow
steps rather than blurred modern shadows. Cards advance `2px` on hover or
keyboard focus over a `150ms steps(2, end)` transition. Reduced-motion mode
removes translation and clamps transition/animation duration while preserving
border, shadow, and focus state. Lantern light belongs to the background scene
and never becomes a glow around controls or status.

## Shapes

Cards use squared `4px` timber frames, a dark inset outline, `3px` corners, and
paper interiors. Status labels and controls use compact pixel-rounded forms.
Configured monitor logos sit in original framed icon containers; missing logos
fall back to an original letter tile in the same container.

## Shared Components

- The fixed `FarmEnvironment` decoration selects day/night and desktop/mobile
  WebP assets from resolved color mode and the `45rem` media query.
- `SiteHeader`, `ColorModeToggle`, and section headings use timber plaques with
  paper-colored display text and crisp focus outlines.
- `OverallStatus`, `ServiceCard`, `IncidentList`, loading, and empty states use
  the same ledger-paper/timber panel construction without changing shared DOM.
- `StatusBadge` and the 90-day history retain dedicated operational, degraded,
  outage, and unknown tokens. Environmental lantern gold is never reused for a
  monitored state.
- `ServiceCard` logo images retain their configured dimensions, source, and alt
  text; the shared first-grapheme fallback receives the same pixel frame.

## Do's and Don'ts

### Do:

- **Do** keep service data calmer and clearer than the surrounding scenery.
- **Do** author every sprite, frame, logo container, and environmental asset.
- **Do** make day/night mode a complete palette and environment change.
- **Do** drop decorative scenery first on small or constrained screens.

### Don't:

- **Don't** copy the referenced game's logo, title treatment, characters, sprites,
  panels, font, map, buildings, items, music, or sound effects.
- **Don't** use crop or lantern colors in place of semantic status colors.
- **Don't** turn the background scene into an interactive game or add product
  functionality through the theme.
- **Don't** allow pixel decoration to obscure response time, status text, history,
  timestamps, focus, or reduced-motion behavior.
