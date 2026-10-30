# [TE-037] Marker commands and overlay drawing

Milestone: M4 Maps, layers and markers · Size: M · Depends on: TE-032, TE-035

## Context

Marker layers hold rectangles, points, ellipses, polygons and polylines with a name, class and
properties (SPEC §8). NGNE has no line or polygon primitives, so markers draw on the Canvas2D
overlay above all tile layers (ENGINE §7).

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §8 (markers, drawing, budget).
- [FORMAT.md](../FORMAT.md) §1.5 (shapes), §2.5 (Marker, marker limits).
- [DESIGN.md](../DESIGN.md) §4 (marker look), §8.2 (marker layer colour in the popover).
- [ENGINE.md](../ENGINE.md) §6 (pan budget), §7 (no line primitives).

## Required work

- Marker commands: add (takes `nextMarkerId`), delete, move, resize, set points, rename, class;
  limits of FORMAT §2.8 refused.
- Overlay draw layer: outlines 1.5 CSS px in the layer colour on a 1 px black halo; rectangles,
  ellipses and polygons filled at 15%; points as a `MapPin` anchored at its tip; names in a chip
  beside the shape above zoom 1; hidden marker layers not drawn; drawn above every tile layer,
  ignoring layer order and opacity; offsets and parallax applied as for tile layers.
- Marker layer colour field in the layer popover (adapted `ColourPicker`).

## Acceptance criteria

- [ ] `tests/unit/te-037-marker-commands.test.ts`: each command passes the TE-006 symmetry
      harness; IDs never reused; limits refused.
- [ ] `tests/e2e/te-037-drawing.spec.ts`: each shape drawn at its position (overlay readback);
      names appear only above zoom 1; a hidden layer draws nothing; colour edits apply.
- [ ] Measured on reference hardware: 2,000 markers on the reference map stay within the pan
      budget of ENGINE §6.

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-037-*`; perf page `tests/perf/te-037-*`.

## Dependencies and scope

- Depends on TE-032, TE-035.
- Out of scope: marker tools (TE-038, TE-039), properties (TE-040).

## Documentation

Raw 2,000-marker pan result under `docs/evidence/` (README, Measurements); SPEC §8 holds the
budget and is unchanged.

## Completion handoff

Report per [RULES 12](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
