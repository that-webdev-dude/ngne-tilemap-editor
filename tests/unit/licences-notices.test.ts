import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
    PACKAGE_STAND_IN_TEXTS,
    buildLicencesFile,
    buildPackageDirs,
    packageDirsOf,
    readPackageLicence,
    runtimePackageDirs,
    strayPackages,
} from "@ngne/editor-ui/licences/build";

// This app's open-source licences file (`licences.txt`), as @ngne/editor-ui's build helper
// writes it with the options of vite.config.ts: the app's licence and its notices
// (THIRD_PARTY_NOTICES.md), the runtime dependencies of package-lock.json, rolldown, the
// bundler, whose virtual modules every build renders, and vite, whose preload helper a build
// with a dynamic import renders. The packages are those the development server lists, which
// hold every package a build can bundle.

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
/** The options vite.config.ts passes to `generateLicences`. */
const OPTIONS = {
    root: ROOT,
    title: "NGNE Tilemap Editor",
    buildPackages: ["node_modules/rolldown", "node_modules/vite"],
};

const lock = readFileSync(join(ROOT, "package-lock.json"), "utf8");
const runtime = runtimePackageDirs(lock, ROOT);
const bundler = buildPackageDirs(ROOT, OPTIONS.buildPackages);
const dirs = packageDirsOf([...runtime, ...bundler].map((dir) => `${dir}/package.json`));
const text = buildLicencesFile(dirs, OPTIONS);

describe("the app's licences file", () => {
    it("holds this project's licence and its notices: libtiled, Zingl, Aseprite, pixman, qjsonparser", () => {
        expect(text.startsWith("NGNE Tilemap Editor: open source licences\n")).toBe(true);
        expect(text).toContain(readFileSync(join(ROOT, "LICENSE"), "utf8").split("\n")[2]);
        expect(text).toContain("## libtiled (BSD-2-Clause)");
        expect(text).toContain("Copyright 2008-2011, Thorbjørn Lindeijer <thorbjorn@lindeijer.nl>");
        expect(text).toContain("## Bresenham curve rasterizing algorithms (MIT)");
        expect(text).toContain("Copyright (c) 2020 zingl");
        expect(text).toContain("## Aseprite Document Library (MIT)");
        expect(text).toContain("## pixman (MIT)");
        expect(text).toContain("## qjsonparser (permissive notice)");
        expect(text).toContain("Copyright (c) 2010 Girish Ramakrishnan <girish@forwardbias.in>");
        expect(text).toContain("Use, modification and distribution is allowed without limitation,");
    });

    it("lists rolldown, the bundler, with its licence and its third-party licence", () => {
        // Development dependencies, listed as build-only packages alone.
        expect(strayPackages(bundler, runtime)).toEqual([
            "node_modules/rolldown",
            "node_modules/vite",
        ]);
        const [rolldown] = bundler;
        const entry = readPackageLicence(rolldown!, [PACKAGE_STAND_IN_TEXTS]);
        expect(entry.texts.map(({ file }) => file)).toEqual(["LICENSE", "THIRD-PARTY-LICENSE"]);
        const heading = `rolldown ${entry.version} (MIT)`;
        expect(text).toContain(`\n${heading}\n`);
        const section = text.slice(text.indexOf(`${"-".repeat(78)}\n${heading}\n`));
        expect(section).toMatch(/^-{78}\nrolldown \S+ \(MIT\)\n-{78}\n\[LICENSE\]\n/);
        expect(section).toContain("\n[THIRD-PARTY-LICENSE]\n");
    });

    it("takes the licence of react-remove-scroll-bar, which ships none, from the package's stand-in", () => {
        expect(text).toContain("[@ngne/editor-ui/licence-texts/react-remove-scroll-bar.txt]");
        expect(text).toContain("Copyright (c) 2025 Anton Korzunov");
    });
});
