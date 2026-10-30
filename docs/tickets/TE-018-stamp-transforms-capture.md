# [TE-018] Stamp transforms and capture

Milestone: M2 Tile tools · Size: M · Depends on: TE-017

## Context

Stamps flip and rotate as a whole (SPEC §4.2, §2.3), and a right drag captures a stamp from the
map, as in Tiled.

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §2.3 (orientation algebra), §4.2 (transforms, capture).
- [DESIGN.md](../DESIGN.md) §5 (Tileset menu stamp items), §7 (stamp brush context bar),
  §10.3 (R, Shift+R, F, Shift+F).
- `core/cells` stamp transform (TE-004).

## Required work

- Commands Flip Stamp Horizontally, Flip Stamp Vertically, Rotate Stamp Right, Rotate Stamp Left
  (Tileset menu; R, Shift+R, F, Shift+F; context bar buttons). They change the stamp only.
- Capture with the stamp brush active: right drag selects a rectangle of the active layer; on
  release it becomes the current stamp and the stamp brush is selected; Shift held at release
  also erases the captured cells (one entry); a right click without drag captures one cell.
- Capture exposed so fill tools (TE-019) enable it too.

## Acceptance criteria

- [ ] `tests/e2e/te-018-transforms.spec.ts`: each key transforms the stamp; painting a rotated
      2 × 3 stamp writes a 3 × 2 block with the composed flags; the map is unchanged by the
      transform itself.
- [ ] `tests/e2e/te-018-capture.spec.ts`: right drag captures (empty cells kept empty); Shift
      capture cuts in one entry and undo restores; right click captures one cell.

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-018-*`.

## Dependencies and scope

- Depends on TE-017.
- Out of scope: fill tools (TE-019).

## Documentation

Unaffected.

## Completion handoff

Report per [RULES 13](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
