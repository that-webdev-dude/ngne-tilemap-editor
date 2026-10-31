import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// TE-010: src/app/worker imports nothing outside src/core and its own folder (SPEC §1),
// checked by linting probe sources at virtual paths, as te-001-layers does.
const eslint = new ESLint();

async function ruleIds(filePath: string, source: string): Promise<string[]> {
    const [result] = await eslint.lintText(source, { filePath });
    return (result?.messages ?? [])
        .filter((message) => message.severity === 2)
        .map((message) => message.ruleId ?? "fatal");
}

/** The rules that report errors, each once: one import may match several patterns. */
async function rules(filePath: string, source: string): Promise<string[]> {
    return [...new Set(await ruleIds(filePath, source))];
}

const TOP = "src/app/worker/probe.ts";
const NESTED = "src/app/worker/tasks/probe.ts";

// The first lint loads ESLint and its plugins: over 20 s on a cold Windows file cache.
describe("src/app/worker imports", { timeout: 60_000 }, () => {
    it("allows src/core, its own folder and the import.meta declarations", async () => {
        const top =
            'import "../../core/pack";\nimport "../../core/codec";\nimport "./protocol";\n' +
            'import "./tasks/png.task";\nimport type {} from "../../import-meta";\n';
        expect(await ruleIds(TOP, top)).toEqual([]);
        const nested =
            'import "../../../core/model";\nimport "../protocol";\nimport "./zip.task";\n' +
            'import type {} from "../../../import-meta";\n';
        expect(await ruleIds(NESTED, nested)).toEqual([]);
    });

    it("rejects the rest of src/app, src/ui and src/engine", async () => {
        const cases: [string, string][] = [
            [TOP, 'import "../state/session";\n'],
            [TOP, 'import "../commands/registry";\n'],
            [TOP, 'import "../../ui/App";\n'],
            [TOP, 'import "../../engine/testing/readCanvas";\n'],
            [TOP, 'import "../../main";\n'],
            [NESTED, 'import "../../state/session";\n'],
            [NESTED, 'import "../../../ui/App";\n'],
            [TOP, 'import type { S } from "../state/session";\nexport type T = S;\n'],
            [TOP, 'export { x } from "../state/session";\n'],
        ];
        for (const [filePath, source] of cases) {
            expect(await ruleIds(filePath, source), `${filePath}: ${source}`).toEqual([
                "no-restricted-imports",
            ]);
        }
    });

    it("rejects packages, src/core/sprite and paths that are not normalized", async () => {
        const cases = [
            'import "react";\n',
            'import "zustand";\n',
            'import "fflate";\n',
            'import "@ngne/core";\n',
            'import "../../core/sprite/png";\n',
            'import "../../core/../app/state/session";\n',
            'import "./tasks/../../state/session";\n',
        ];
        for (const source of cases) {
            expect(await rules(TOP, source), source).toEqual(["no-restricted-imports"]);
        }
    });

    it("rejects dynamic imports and globs outside the folder", async () => {
        expect(await ruleIds(TOP, 'export const a = import("./protocol");\n')).toEqual([
            "no-restricted-syntax",
        ]);
        for (const pattern of ["../**/*.task.ts", "/src/**/*.task.ts", "./x/../../y/*.ts"]) {
            const source = `export const a = import.meta.glob("${pattern}", { eager: true });\n`;
            expect(await ruleIds(TOP, source), pattern).toEqual(["no-restricted-syntax"]);
        }
        const template =
            "export const a = import.meta.glob(`../../ui/**/*.ts`, { eager: true });\n";
        expect(await ruleIds(TOP, template)).toEqual(["no-restricted-syntax"]);
        const inside = 'export const a = import.meta.glob("./**/*.task.ts", { eager: true });\n';
        expect(await ruleIds(TOP, inside)).toEqual([]);
    });

    it("applies at any depth of the folder", async () => {
        const deep = "src/app/worker/a/b/c/d/e/f/g/probe.ts";
        expect(await rules(deep, 'import "zustand";\n')).toEqual(["no-restricted-imports"]);
        expect(await rules(deep, 'import "../../../../../../../../state/session";\n')).toEqual([
            "no-restricted-imports",
        ]);
        expect(await ruleIds(deep, 'import "../../../../../../../../../core/model";\n')).toEqual(
            [],
        );
    });

    it("leaves the rest of src/app as it was", async () => {
        expect(await ruleIds("src/app/state/probe.ts", 'import "zustand";\n')).toEqual([]);
    });
});
