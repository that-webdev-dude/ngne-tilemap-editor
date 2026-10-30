# [TE-032] Maps panel, New Map and Map Properties dialogs

Milestone: M4 Maps, layers and markers · Size: M · Depends on: TE-031

## Context

The Maps dock section lists the project's maps; New Map and Map Properties are the dialogs that
set a map's fields (DESIGN §8.1, §9; SPEC §7.1).

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §7.1 (New Map, Map Properties, tile-size change).
- [DESIGN.md](../DESIGN.md) §3.3 row `ui/colour/ColourPicker.tsx`; §3.4 row
  `ui/sprite/NewSpriteDialog.tsx`; §8.1 (Maps panel); §9 (New Map, Map Properties rows);
  §10.3 (Ctrl+Alt+M, F2).
- [FORMAT.md](../FORMAT.md) §2.5 (Map members and ranges).

## Required work

- Maps dock section: one row per map (name, open-tab dot, `w × h` muted); click opens or selects
  its tab; double click or F2 renames in place; drag reorders; row menu Map Properties…,
  Duplicate, Delete; header New Map (+).
- New Map dialog: name, width, height (cells), tile width and height, size presets (32 × 32,
  64 × 64, 128 × 128, 256 × 256, 1000 × 40); Ctrl+Alt+M.
- Map Properties dialog: name, export name (slug, unique), class, tile size, background colour
  (adapted `ColourPicker` in a popover, "None"), parallax origin X/Y. Changing the tile size
  keeps cells; markers and offsets stay in pixels.

## Acceptance criteria

- [ ] `tests/e2e/te-032-maps-panel.spec.ts`: rows mirror the map list; rename in place; drag
      reorder is one entry; row menu commands work.
- [ ] `tests/e2e/te-032-dialogs.spec.ts`: presets fill the fields; New Map adds and opens a map;
      each Map Properties change is one entry and undoable; a duplicate export name is refused.
- [ ] The background colour shows in the viewport (readback) and "None" removes it.

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-032-*`.

## Dependencies and scope

- Depends on TE-031.
- Out of scope: properties list (TE-040), Resize / Offset Map (TE-033).

## Documentation

Adds rows to `docs/PROVENANCE.md`. Other docs unchanged.

## Completion handoff

Report per [RULES 12](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
