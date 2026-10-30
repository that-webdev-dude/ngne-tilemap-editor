# [TE-035] Layers panel

Milestone: M4 Maps, layers and markers · Size: L · Depends on: TE-034

## Context

The Layers dock section shows the active map's layer tree with toggles, a properties popover and
drag reordering (DESIGN §8.2).

## Relevant code and documentation

- [DESIGN.md](../DESIGN.md) §3.2 row `ui/timeline/useClosingPopover.ts`; §3.4 rows
  `ui/timeline/LayerRow.tsx`, `LayerProperties.tsx`; §4 (layer type icons); §8.2 (Layers
  panel); §10.1 (`panel` context), §10.3 (F2).
- [SPEC.md](../SPEC.md) §7.2.
- Layer commands (TE-034).

## Required work

- Tree, top of the stack first, 28 px rows: 12 px indent per group level, disclosure triangle,
  type icon, name, visibility and lock toggles; opacity shown on hover, focus and below 255.
- Layer properties popover (name, class, opacity slider, offset X/Y, parallax X/Y), applied on
  close; kind-specific fields register from their own modules (image and repeat: TE-036;
  marker colour: TE-037).
- Active row `--bg-active` with a 2 px accent bar; hidden or locked ancestry shows muted text.
- Drag reorders; a drop on a group row's middle third moves into the group.
- Header: New Tile Layer (+) with a variant menu for the other kinds, Delete.
- Keyboard: one tab stop; ↑ ↓ move, ← → collapse/expand, Enter makes active, F2 renames.

## Acceptance criteria

- [ ] `tests/e2e/te-035-panel.spec.ts`: rows mirror the tree; toggles and popover edits are one
      entry each; drag reorder and drop into a group work and undo.
- [ ] Keyboard navigation, Enter and F2 work without a pointer.
- [ ] Muted rows under a hidden or locked group; accent bar on the active row.

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-035-*`.

## Dependencies and scope

- Depends on TE-034.
- Out of scope: image layer fields (TE-036), marker layer colour (TE-037), custom properties
  (TE-040).

## Documentation

Adds rows to `docs/PROVENANCE.md`. Other docs unchanged.

## Completion handoff

Report per [RULES 13](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
