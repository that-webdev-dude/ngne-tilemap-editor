# [TE-034] Layer commands

Milestone: M4 Maps, layers and markers · Size: M · Depends on: TE-015

## Context

Layers follow Tiled's model: tile, marker, image and group layers in a tree with visibility,
lock, opacity, offset, parallax and class (SPEC §7.2). This ticket adds every layer command and
its viewport effect; the panel is TE-035.

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §7.2 (layers, limits, envelope warning).
- [FORMAT.md](../FORMAT.md) §2.5 (Layer members, group composition), §2.8 (layer limits).
- [DESIGN.md](../DESIGN.md) §5 (Layer menu), §10.3 (↑, ↓, Ctrl+Shift+↑/↓, Shift+N,
  Ctrl+Shift+D, Shift+H).
- [ENGINE.md](../ENGINE.md) §4 (rebuild after visibility, opacity, parallax, offset changes).

## Required work

- New Tile Layer (Shift+N), New Marker Layer, New Group; Group Layers, Ungroup; Duplicate
  (Ctrl+Shift+D; new IDs for the layer and its markers); Delete; Rename; move up/down
  (Ctrl+Shift+↑/↓) and move into and out of groups; Select Layer Above/Below (↑/↓ with the
  viewport focused, no marker selection).
- Setters as commands: visible, locked, opacity, offset, parallax, class.
- Show/Hide Other Layers, Lock/Unlock Other Layers.
- Highlight Current Layer (Shift+H, view preference): other layers at the preference's opacity.
- Limits: 256 layers, 16 group levels refused; the D1 envelope warning once per map ("This map is
  beyond the editor's tested envelope").

## Acceptance criteria

- [ ] `tests/unit/te-034-layer-commands.test.ts`: every command passes the TE-006 symmetry
      harness; IDs never reused; limits refused.
- [ ] `tests/e2e/te-034-layers.spec.ts`: hiding, opacity, offset, parallax and group nesting
      change the viewport as the compositor reference does (readback), in both tiers.
- [ ] Highlight Current Layer draws other layers at 25% (readback); the setting survives reload.
- [ ] The envelope warning appears once per map.

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-034-*`.

## Dependencies and scope

- Depends on TE-015.
- Out of scope: Layers panel (TE-035), image layers (TE-036), marker content (TE-037).

## Documentation

Unaffected.

## Completion handoff

Report per [RULES 12](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
