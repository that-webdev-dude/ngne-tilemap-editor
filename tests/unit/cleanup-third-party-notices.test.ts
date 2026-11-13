import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
    NOTICES_FILE,
    SECTION_HEADING,
    committedNpmSection,
    npmSection,
    packageNotices,
    withNpmSection,
} from "../../scripts/third-party-notices";

// The npm section of public/THIRD-PARTY-NOTICES.txt (scripts/third-party-notices.ts): the
// licence of every npm package whose code can reach the built app, which the build ships in
// dist/. It must match the installed packages; after an install or update, write it again
// with `node scripts/third-party-notices.ts`.

const manifest = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as {
    dependencies: Record<string, string>;
};

describe("third-party notices", () => {
    it("commits exactly the npm section a fresh run writes (drift)", () => {
        expect(committedNpmSection()).toBe(npmSection());
    });

    it("covers every production dependency at its pinned version, and the bundler", () => {
        const listed = new Map(packageNotices().map((notice) => [notice.name, notice.version]));
        for (const [name, version] of Object.entries(manifest.dependencies)) {
            expect(listed.get(name), name).toBe(version);
        }
        expect(listed.has("rolldown")).toBe(true);
        // Development packages stay out, apart from the bundler.
        expect(listed.has("vite")).toBe(false);
        expect(listed.has("typescript")).toBe(false);
    });

    it("gives every package a licence text", () => {
        for (const notice of packageNotices()) {
            expect(notice.text.length, notice.name).toBeGreaterThan(100);
            expect(committedNpmSection()).toContain(`- ${notice.name} ${notice.version}\n`);
        }
    });

    it("replaces only the npm section, keeping the sections written by hand", () => {
        const file = readFileSync(NOTICES_FILE, "utf8").replace(/\r\n/g, "\n");
        const handWritten = file.slice(0, file.indexOf(`\n${SECTION_HEADING}\n`) + 1);
        expect(handWritten).toContain("1. libtiled");
        expect(withNpmSection(file, `${SECTION_HEADING}\nx\n`)).toBe(
            `${handWritten}${SECTION_HEADING}\nx\n`,
        );
    });
});
