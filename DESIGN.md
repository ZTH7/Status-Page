---
name: Status Page
description: A restrained, card-based status interface with precise motion and complete light/dark modes.
---

<!-- IMPLEMENTED: Quiet Signal default-theme tokens and shared semantic components recorded from Task 10. -->

# Design System: Status Page

## Overview

**Creative North Star: "Quiet Signal"**

The default theme is a direct, modern status interface whose visual confidence
comes from proportion, typography, state clarity, and motion quality. It plays
the category standard straight: a visitor sees an overall status, scans a set of
service cards, and reads history without decoding a visual metaphor.

The system is minimal but not inert. Cards respond with short, physically
coherent elevation; status changes settle cleanly; theme changes do not flash or
reflow. Motion always explains hierarchy or state and never becomes ambient
decoration. Linear sets the interaction finish, Vercel sets the light/dark
discipline, and Apple sets the information restraint.

**Key Characteristics:**

- Card-based, spacious, and immediately scannable.
- Restrained neutrals with semantic green, yellow, red, and no decorative color.
- Complete light and dark modes with equal hierarchy and contrast.
- Smooth, short interactions with reduced-motion equivalents.
- No ornamental motif, texture, illustration, or dashboard theatrics in the
  default theme.

## Colors

Use a restrained strategy: neutral backgrounds and surfaces occupy the page;
color communicates status or a separate interactive accent only. These values
are implemented in `themes/default/theme.css` and apply through semantic tokens.

### Primary

- **Interface Accent** `#2563eb` light / `#60a5fa` dark: Focus, active controls,
  and interactive links. It remains separate from monitored state colors.

### Secondary

- **Operational Green** base `#16835f`; light foreground/fill `#116a4e` /
  `#e8f7f0`; dark foreground/fill `#70e0b5` / `#15382e`.
- **Degraded Yellow** base `#a16207`; light foreground/fill `#8b5505` /
  `#fff4d6`; dark foreground/fill `#f5c451` / `#3c2c13`.
- **Outage Red** base `#c2413b`; light foreground/fill `#aa342f` / `#fcebea`;
  dark foreground/fill `#ff9b94` / `#452423`.
- **Unknown Gray** base `#71717a`; light foreground/fill `#5f5f68` /
  `#f0f0f2`; dark foreground/fill `#c4c4cb` / `#2b2d34`.

### Neutral

- **Canvas Light / Canvas Dark** `#f6f7f9` / `#0f1115`.
- **Surface Light / Surface Dark** `#ffffff` / `#17191f`.
- **Primary Text Light / Dark** `#18181b` / `#f4f4f5`.
- **Secondary Text Light / Dark** `#71717a` / `#a1a1aa`.
- **Quiet Border Light / Dark** `#e4e4e7` / `#2a2d35`.

**The Semantic Color Rule.** Green, yellow, and red belong to service state;
they are not decorative accents elsewhere in the default theme.

## Typography

Use `"Geist Variable", system-ui, sans-serif` as the sole default-theme family.
Times, durations, and response values use tabular numerals within that family;
there is no separate display or mono face.

Hierarchy comes from size, weight, and whitespace, not display-font contrast.
Headings remain compact; labels do not rely on excessive tracking or all caps.

**The One-Family Rule.** The default theme does not manufacture personality by
mixing display typefaces; status content stays typographically coherent.

## Layout

Use a centered `72rem` maximum-width container and the composition-C reading
order: header, overall status, search, service feed, incidents, footer. Every
service card is a two-row composition: a compact identity header followed by a
90-day strip that spans the card's full content width. Service name, current
status, and the details trigger share one wrapping line; descriptions stay with
the identity. The same order is preserved below `45rem` (720px).

Spacing uses only the 8/12/16/24/32px rhythm for layout, with a deliberate 1–2px
gap inside the dense history strip. Long names and descriptions wrap. Response
time, HTTP status, last check, and location live in one compact details popover
beside the service name. It opens by hover, keyboard focus, or click, so mobile
preserves every factual field without depending on hover.

## Elevation & Depth

Surfaces are flat at rest and separated by the quiet border. Interactive service
cards gain the single `0 8px 24px rgb(0 0 0 / 8%)` elevation step on hover or
focus-within; the selected history detail reuses that same token as an anchored
overlay without changing card height. CSS pairs card elevation with at most
`2px` translation using `160ms cubic-bezier(.2,.8,.2,1)`. Reduced motion removes
the lift translation while preserving border, shadow, and focus, so the card
does not need runtime animation state or a client animation library.

**The Responsive Elevation Rule.** Elevation communicates interactivity only.
Static containers do not accumulate shadows, and reduced-motion mode removes the
translation without removing focus feedback.

## Shapes

Cards use a `14px` radius. Compact nested controls may use 8–12px radii; full
pills are reserved for status badges and the light/dark control.

## Shared Components

- `SiteHeader` and `ColorModeToggle` own compact configured identity and the
  next color-mode action. The default square mark depicts three read-only
  service rows with neutral blue signal nodes; it contains no text and never
  borrows green, yellow, or red from monitored state.
- `OverallStatus` gives each of the four levels explicit text and a code-native
  mark, with the latest completed check when known.
- `SearchField` exposes the configured placeholder and visible `/` hint while
  the shared search hook owns keyboard behavior. The input exposes the shortcut
  programmatically, and the visible no-match result is a polite status message.
- `ServiceCard`, `ServiceDetails`, `StatusBadge`, and `HistoryStrip` keep identity,
  factual live metadata, and every supplied daily result together in one broad
  article. Metadata is disclosed from the adjacent question-mark control and
  dismisses on focus exit or Escape. The selected day detail is width-contained,
  floats above following cards, and does not alter feed layout. Every supplied
  day shares one full-width grid row with 1–2px gaps and a rounded, full-cell bar;
  the track does not scroll horizontally. Resting bars use full-opacity semantic
  colors so their final light/dark contrast remains at least 3:1.
- `IncidentList` presents received incident timing without invented titles or
  narratives. Loading, unavailable, no-service, no-match, and no-incident states
  remain visually distinct.

## Do's and Don'ts

### Do:

- **Do** make overall and per-service state legible without relying on color alone.
- **Do** make light and dark modes structurally identical and equally complete.
- **Do** keep animation short, interruptible, and tied to hover, focus, entry, or
  a real state change.
- **Do** let typography, spacing, and alignment provide most of the polish.

### Don't:

- **Don't** add grids, instrument panels, star fields, teletext, gradients,
  glass effects, textures, illustrations, or decorative ambient animation to the
  default theme.
- **Don't** turn every datum into its own card or add dashboard widgets outside
  the original product scope.
- **Don't** hide status, history, or controls behind hover-only interactions;
  disclosed metadata must remain reachable by focus and touch.
- **Don't** use green, yellow, or red as generic brand decoration.
