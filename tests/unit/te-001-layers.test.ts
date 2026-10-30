import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// The layer boundaries of RULES 4, checked by linting probe sources at virtual paths.
const eslint = new ESLint();

async function ruleIds(filePath: string, source: string): Promise<string[]> {
    const [result] = await eslint.lintText(source, { filePath });
    return (result?.messages ?? [])
        .filter((message) => message.severity === 2)
        .map((message) => message.ruleId ?? "fatal");
}

const NGNE = 'import "@ngne/core";\n';
const REACT = 'import "react";\n';
const DOM_GLOBALS = [
    "export const a = document.body;\n",
    "export const a = window.innerWidth;\n",
    "export const a = new ImageData(1, 1);\n",
    "export const a = navigator.gpu;\n",
];

// The first lint loads ESLint and its plugins: over 20 s on a cold Windows file cache.
describe("layer boundaries", { timeout: 60_000 }, () => {
    it("rejects @ngne/core in src/core", async () => {
        expect(await ruleIds("src/core/probe.ts", NGNE)).toEqual(["no-restricted-imports"]);
    });

    it("rejects React in src/core", async () => {
        expect(await ruleIds("src/core/probe.ts", REACT)).toEqual(["no-restricted-imports"]);
    });

    it("rejects DOM globals in src/core", async () => {
        for (const source of DOM_GLOBALS) {
            expect(await ruleIds("src/core/probe.ts", source), source).toEqual([
                "no-restricted-globals",
            ]);
        }
    });

    it("rejects imports from app, engine and ui in src/core", async () => {
        for (const layer of ["app", "engine", "ui"]) {
            const source = `import "../../${layer}/x";\n`;
            expect(await ruleIds("src/core/model/probe.ts", source), layer).toEqual([
                "no-restricted-imports",
            ]);
        }
    });

    it("allows platform-neutral globals in src/core", async () => {
        const source = "export const a = new Uint8ClampedArray(4);\nexport const b = Math.max;\n";
        expect(await ruleIds("src/core/probe.ts", source)).toEqual([]);
    });

    it("rejects @ngne/core in src/app and src/ui", async () => {
        for (const filePath of ["src/app/probe.ts", "src/ui/probe.tsx"]) {
            expect(await ruleIds(filePath, NGNE), filePath).toEqual(["no-restricted-imports"]);
        }
    });

    it("allows the same code in src/engine", async () => {
        for (const source of [NGNE, REACT, ...DOM_GLOBALS]) {
            expect(await ruleIds("src/engine/probe.ts", source), source).toEqual([]);
        }
    });
});
