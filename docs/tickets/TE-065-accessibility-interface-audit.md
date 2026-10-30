# [TE-065] Accessibility and interface audit

Milestone: M9 Hardening and release · Size: M · Depends on: TE-063

## Context

The editor must be indistinguishable from the sprite editor and meet its accessibility rules
(BRIEF §2, DESIGN §1, `se-design` §8), verified at 1280 × 720 and 125% zoom (SPEC §15).

## Relevant code and documentation

- [DESIGN.md](../DESIGN.md) (whole file; §10.4 pointer-target exceptions).
- [SUITE.md](../SUITE.md) §2–§4.
- [SPEC.md](../SPEC.md) §15 (Manual row).
- `se/tests/e2e/se-071-*` (pattern).

## Required work

- axe scans of every panel, dialog and surface in both themes.
- Keyboard-only walk: every command reachable; F6 regions; panels operable per DESIGN §10.4.
- Pointer targets ≥ 24 × 24 px except DESIGN §10.4; tooltips with name and key; `aria-label` on
  icon-only controls.
- Layout at 1280 × 720 and 125% browser zoom: no clipped control, overflow rules of `se-design`
  §2.
- Fix every finding inside this ticket's scope (UI code); a finding that needs a doc change is
  reported, not fixed.

## Acceptance criteria

- [ ] `tests/e2e/te-065-axe.spec.ts`: no serious or critical violation on any surface, both
      themes.
- [ ] `tests/e2e/te-065-keyboard.spec.ts`: the keyboard-only walk completes.
- [ ] `tests/e2e/te-065-targets.spec.ts`: every interactive element ≥ 24 × 24 px except the listed
      exceptions; every icon-only control has an `aria-label`.
- [ ] Owner check card below passes.

**Owner check — interface against DESIGN.md**

1. `npm run build && npm run preview`, open `http://localhost:4183/` in Chrome at 1280 × 720,
   then at 125% zoom.
2. Open each menu, panel and dialog of DESIGN §5–§9 side by side with the sprite editor.
3. Expected: same look and manners; nothing clipped or overlapping.
4. Reply `ui pass`, or `ui fail: <surface> <what differs>`.

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-065-*`; the owner check above.

## Dependencies and scope

- Depends on TE-063.
- Out of scope: PWA (TE-066).

## Documentation

Unaffected; doc-level findings are listed in the report.

## Completion handoff

Report per [RULES 12](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
