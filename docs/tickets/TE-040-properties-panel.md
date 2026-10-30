# [TE-040] Properties panel

Milestone: M4 Maps, layers and markers · Size: L · Depends on: TE-025, TE-037

## Context

The Properties dock section edits built-in fields and custom properties of the current selection:
markers, tiles, layer, map, and from their menus the project and tileset (SPEC §9,
DESIGN §8.3).

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §9 (selection order, types, conversion, multi-select).
- [FORMAT.md](../FORMAT.md) §1.4 (property types, limits, sort order).
- [DESIGN.md](../DESIGN.md) §8.3 (panel), §3.3 row `ui/colour/ColourPicker.tsx`.

## Required work

- Selection order: selected markers, else selected tiles (Tilesets panel focus), else the active
  layer, else the map; project and active tileset reachable from their menus.
- Built-in fields per kind (name, class, and the kind's own fields), then Custom properties rows
  `name · type chip · value control` sorted by name.
- Add (popover: Name, Type, Add), Rename, Change Type (value converted where it can be, else the
  type's default: `false`, `0`, `""`, `#000000ff`), Remove; controls per type: checkbox, integer
  and number fields, text, colour picker, file name field with Pick (takes the chosen file's
  name).
- Several items: a property common to all shows; editing sets it on all; differing values show
  "—".
- Header names what is shown ("Marker · exit", "3 tiles", "Layer · Ground", "Map · Overworld").
- Every edit an undoable command; limits (256 per list, value lengths) refused.

## Acceptance criteria

- [ ] `tests/unit/te-040-conversion.test.ts`: every type-to-type conversion and default.
- [ ] `tests/e2e/te-040-properties.spec.ts`: the panel follows the selection order; add, rename,
      change type, edit and remove each one entry; multi-select shows "—" and sets all.
- [ ] Property commands pass the TE-006 symmetry harness.

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-040-*`.

## Dependencies and scope

- Depends on TE-025, TE-037.
- Out of scope: `object` and `list` types, custom classes and enums (Later).

## Documentation

Unaffected.

## Completion handoff

Report per [RULES 12](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
