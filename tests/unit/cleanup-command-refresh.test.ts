import { describe, expect, it } from "vitest";
import { createCommandRegistry } from "../../src/app/commands/registry";
import { createCommandTracker } from "../../src/ui/commands/commandTracker";

// TE-053 measurement: every refresh of the command registry rendered every component of
// `useCommands` again (about 13 ms on reference hardware), so a file operation starting (its
// `busy` toggle) put the export over its 16 ms task budget. `useCommands` now renders a
// component again only when a command it read changed. These tests pin when the tracker's
// snapshot changes; the cost is measured by tests/perf/te-053-export.perf.ts.

function setup() {
    const registry = createCommandRegistry();
    const state = { save: true, open: true, title: "Undo" };
    registry.register({ id: "file.save", title: "Save", enabled: () => state.save, run() {} });
    registry.register({ id: "file.open", title: "Open", enabled: () => state.open, run() {} });
    registry.register({ id: "edit.undo", title: () => state.title, run() {} });
    const tracker = createCommandTracker(registry);
    const find = (id: string) => tracker.commands().find((command) => command.id === id)!;
    return { registry, state, tracker, find };
}

describe("useCommands tracker", () => {
    it("keeps its snapshot through a refresh that changes nothing the component read", () => {
        const { registry, state, tracker, find } = setup();
        const before = tracker.snapshot();
        expect(find("file.save").enabled()).toBe(true);
        expect(find("edit.undo").title()).toBe("Undo");
        // `file.open` was never read: its change is not the component's.
        state.open = false;
        registry.refresh();
        expect(tracker.snapshot()).toBe(before);
    });

    it("changes its snapshot when a read command's enabled state changes, once", () => {
        const { registry, state, tracker, find } = setup();
        const before = tracker.snapshot();
        find("file.save").enabled();
        state.save = false;
        registry.refresh();
        const after = tracker.snapshot();
        expect(after).not.toBe(before);
        // Stable until the next change, as useSyncExternalStore needs.
        expect(tracker.snapshot()).toBe(after);
        expect(find("file.save").enabled()).toBe(false);
        expect(tracker.snapshot()).toBe(after);
    });

    it("changes its snapshot when a read command's title changes", () => {
        const { registry, state, tracker, find } = setup();
        const before = tracker.snapshot();
        find("edit.undo").title();
        state.title = "Undo Stamp Brush";
        registry.refresh();
        expect(tracker.snapshot()).not.toBe(before);
    });

    it("changes its snapshot when a command is added or removed", () => {
        const { registry, tracker } = setup();
        const before = tracker.snapshot();
        const remove = registry.register({ id: "view.fit", title: "Fit", run() {} });
        const added = tracker.snapshot();
        expect(added).not.toBe(before);
        remove();
        expect(tracker.snapshot()).not.toBe(added);
    });

    it("keeps each command's identity across refreshes", () => {
        const { registry, tracker, find } = setup();
        const save = find("file.save");
        registry.refresh();
        expect(find("file.save")).toBe(save);
        expect(tracker.commands()).toHaveLength(3);
    });

    it("hands out commands that run and report as the registry's", async () => {
        const registry = createCommandRegistry();
        let ran = 0;
        registry.register({
            id: "edit.go",
            title: "Go",
            shortcut: "Ctrl+G",
            run: () => void ran++,
        });
        const tracker = createCommandTracker(registry);
        const [command] = tracker.commands();
        await command!.run();
        expect(ran).toBe(1);
        expect(command!.shortcuts).toEqual(registry.get("edit.go")!.shortcuts);
    });
});
