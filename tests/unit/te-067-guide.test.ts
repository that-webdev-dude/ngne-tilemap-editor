import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateRuntime } from "../../src/core/runtime/generate";

// TE-067: the game example of docs/GUIDE.md ("Use `ngne-tilemap.ts` in a game") compiles as a
// game's `src/game.ts` beside an export folder `src/maps/` holding the map it loads, against the
// app's `@ngne/core` 0.3.0, under the strict settings the runtime compile matrix uses
// (tests/runtime-compat/tsconfig.base.json). The folder lies under .test-output/ in the
// repository, so `@ngne/core` resolves from its node_modules.

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** The one TypeScript block between the guide's example markers. */
function guideExample(): string {
    const guide = readFileSync(join(ROOT, "docs/GUIDE.md"), "utf8").replace(/\r\n/g, "\n");
    expect(guide.match(/<!-- guide-example:start -->/g)).toHaveLength(1);
    expect(guide.match(/<!-- guide-example:end -->/g)).toHaveLength(1);
    const section = /<!-- guide-example:start -->([\s\S]*?)<!-- guide-example:end -->/.exec(guide);
    expect(section?.[1]?.match(/```ts\n/g)).toHaveLength(1);
    const block = /^```ts\n([\s\S]*?)^```$/m.exec(section?.[1] ?? "");
    expect(block).not.toBeNull();
    return block![1]!;
}

describe("the user guide's game example", () => {
    let folder = "";

    beforeAll(() => {
        mkdirSync(join(ROOT, ".test-output"), { recursive: true });
        folder = mkdtempSync(join(ROOT, ".test-output", "te-067-guide-"));
    });

    afterAll(() => {
        rmSync(folder, { recursive: true, force: true });
    });

    it("compiles against @ngne/core 0.3.0 and the generated runtime", () => {
        mkdirSync(join(folder, "src/maps"), { recursive: true });
        const game = join(folder, "src/game.ts");
        writeFileSync(game, guideExample());
        writeFileSync(
            join(folder, "src/maps/ngne-tilemap.ts"),
            generateRuntime({ tilemaps: ["overworld"], tilesets: ["terrain"], images: [] }),
        );
        const program = ts.createProgram([game], {
            target: ts.ScriptTarget.ES2022,
            lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            types: [],
            strict: true,
            exactOptionalPropertyTypes: true,
            noUnusedLocals: true,
            noUnusedParameters: true,
            verbatimModuleSyntax: true,
            allowImportingTsExtensions: false,
            resolveJsonModule: false,
            skipLibCheck: false,
            noEmit: true,
        });
        const messages = ts
            .getPreEmitDiagnostics(program)
            .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
        expect(messages).toEqual([]);
        // The example uses the app's engine, not a stray copy.
        const engine = program
            .getSourceFiles()
            .map((file) => file.fileName.replace(/\\/g, "/"))
            .find((name) => name.includes("/node_modules/@ngne/core/"));
        expect(engine).toBeDefined();
    }, 60_000);
});
