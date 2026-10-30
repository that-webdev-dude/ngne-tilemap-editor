# [TE-003] Design system, primitives and app shell

Milestone: M0 Foundation · Size: L · Depends on: TE-002

## Context

The editor must look and behave like the sprite editor (BRIEF D13). Its tokens, primitives,
focus rules, toasts, dialog host, dock and shell regions are copied from `se/`, then the shell is
adapted to this editor's regions (SUITE §3, DESIGN §2).

## Relevant code and documentation

- [SUITE.md](../SUITE.md) §2 (design system), §3 (layout), §7 (storage names).
- [DESIGN.md](../DESIGN.md) §1, §2, §3 (rows named below), `se-design` §1–§4, §6, §8.
- `se/src/ui/styles/`, `ui/primitives/`, `ui/focus/`, `ui/toast/`, `ui/dialogs/`,
  `app/dialogs/dialogRequests.ts`, `ui/platform/`, `ui/shell/`, `ui/gallery/Gallery.tsx`,
  `ui/dock/`, `ui/theme/theme.ts`, `app/notices/notices.ts`, `app/platform/storage.ts`.
- `docs/PROVENANCE.md`, `scripts/drift.ts` (TE-002).

## Required work

- Copy from `se/` at `ea5c91d` the DESIGN §3.2 rows for styles (with the token test),
  primitives, focus, toast, dialog host and registry, `dialogRequests`, platform, `RegionBoundary`,
  `layout.ts`, `WindowTooSmall`, `notice.css`, gallery, `DockSection` and dock registry,
  `notices.ts`, `storage.ts`. Check each verbatim row's imports exist here; a row that cannot hold
  moves to Adapt, recorded in `docs/PROVENANCE.md` (DESIGN §3).
- Adapt `ui/theme/theme.ts` (key `ngne-tilemap-editor.theme`), `WebGpuRequired.tsx` (product
  name), `AppShell.tsx`, `layoutStore.ts`, `RailFrame.tsx` and the region components: menu bar,
  tool rail, context bar, viewport, right dock, bottom panel in the timeline's slot with its
  splitter and tabs Tilesets | Terrains, status bar. Regions are empty placeholders until their
  tickets fill them.
- Right dock sections Maps, Layers, Properties, Preview, Minimap registered as empty collapsible
  sections; Preview and Minimap start collapsed under 800 px window height.
- Notices: WebGPU required; window too small (1280×720). Error boundary per region.
- Dev gallery route with every primitive.

## Acceptance criteria

- [ ] `tests/e2e/te-003-shell.spec.ts`: at 1280×720 each region has the size of SUITE §3 and
      `se/src/ui/shell/layout.ts`; dock sections in DESIGN §2 order; Preview and Minimap
      collapsed at 1280×720, expanded at 1920×1080.
- [ ] `tests/e2e/te-003-notices.spec.ts`: the WebGPU-required notice names "NGNE Tilemap Editor"
      when `navigator.gpu` is absent; the window-too-small notice shows below 1280×720.
- [ ] Theme: dark by default; the light theme set and reloaded persists under
      `ngne-tilemap-editor.theme` (E2E).
- [ ] The token test passes; only `tokens.css` holds raw colours.
- [ ] A component that throws inside one region shows that region's error boundary while the
      others keep working (E2E).
- [ ] The gallery renders every primitive; an axe scan of the shell and the gallery reports no
      serious or critical violation.
- [ ] `tests/unit/te-002-provenance.test.ts` covers every new verbatim row.

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-003-*`.

## Dependencies and scope

- Depends on TE-002 (provenance hashes, drift script).
- Out of scope: commands, keymap and menus (TE-007), palette, shortcut sheet and preferences
  (TE-008), any panel content.

## Documentation

Adds rows to `docs/PROVENANCE.md`. Other docs unchanged.

## Completion handoff

Report per [RULES 12](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
