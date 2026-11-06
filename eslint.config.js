import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

// DOM globals are the browser set minus what Node and plain ECMAScript also provide, so
// `src/core` stays runnable under Vitest in Node (SPEC §5). `navigator` and the storage
// objects exist in Node too but are host state, so they are restricted explicitly.
const shared = new Set([
    ...Object.keys(globals.nodeBuiltin),
    ...Object.keys(globals["shared-node-browser"]),
    ...Object.keys(globals.es2022),
]);
const domGlobals = [
    ...new Set([
        ...Object.keys(globals.browser).filter((name) => !shared.has(name)),
        "navigator",
        "localStorage",
        "sessionStorage",
    ]),
];

const ngne = {
    group: ["@ngne/core", "@ngne/core/*"],
    message: "Only src/engine imports @ngne/core (SPEC §5).",
};

const spriteCore = {
    regex: "(^|/)core/sprite(/|$)",
    message: "Only src/core imports src/core/sprite (DESIGN §3.1).",
};

// src/core/sprite imports itself, fflate and fast-png only (DESIGN §3.1). A relative import
// leaves the subtree when it climbs more directories than the file sits below it; one that
// climbs back after descending, or a dynamic import, cannot be checked and is refused.
const spriteSubtree = [0, 1, 2, 3, 4, 5, 6, 7].map((depth) => ({
    files: [`src/core/sprite/${"*/".repeat(depth)}*.{ts,tsx}`],
    rules: {
        "no-restricted-imports": [
            "error",
            {
                patterns: [
                    {
                        regex: "^(?!\\.\\.?/)(?!(fflate|fast-png)$)",
                        message: "src/core/sprite imports no package but fflate and fast-png.",
                    },
                    {
                        regex: `^(\\./)?(\\.\\./){${depth}}\\.\\.(/|$)`,
                        message: "src/core/sprite imports nothing from outside itself.",
                    },
                    {
                        regex: "(^|/)(?!\\.\\.?(/|$))[^/]+/\\.\\.(/|$)",
                        message: "src/core/sprite imports by normalized paths only.",
                    },
                ],
            },
        ],
        "no-restricted-syntax": [
            "error",
            {
                selector: "ImportExpression",
                message: "src/core/sprite imports nothing dynamically.",
            },
        ],
    },
}));

// src/app/worker imports only src/core and its own folder (SPEC §1): it is the background
// worker, apart from the app's stores and the DOM. Relative imports are checked as above; it
// may climb to src only for src/core and the `import.meta` declarations. Its glob imports stay
// inside the folder and take a plain string, which the rule can read.
const workerFolder = [0, 1, 2, 3, 4, 5, 6, 7].map((depth) => ({
    files: [`src/app/worker/${"*/".repeat(depth)}*.{ts,tsx}`],
    rules: {
        "no-restricted-imports": [
            "error",
            {
                patterns: [
                    ngne,
                    spriteCore,
                    {
                        regex: "^(?!\\.\\.?/)",
                        message: "src/app/worker imports no package.",
                    },
                    {
                        regex:
                            `^(?!(\\./)?(\\.\\./){${depth + 2}}(core(/|$)|import-meta$))` +
                            `(\\./)?(\\.\\./){${depth}}\\.\\.(/|$)`,
                        message: "src/app/worker imports nothing outside src/core and itself.",
                    },
                    {
                        regex: "(^|/)(?!\\.\\.?(/|$))[^/]+/\\.\\.(/|$)",
                        message: "src/app/worker imports by normalized paths only.",
                    },
                ],
            },
        ],
        "no-restricted-syntax": [
            "error",
            {
                selector: "ImportExpression",
                message: "src/app/worker imports nothing dynamically.",
            },
            {
                selector:
                    "CallExpression[callee.object.type='MetaProperty']" +
                    // esquery's regex literal cannot hold "/": it is written \x2F.
                    "[callee.property.name='glob'] > Literal[value=/^(?!\\.\\x2F)|\\.\\.\\x2F/]",
                message: "src/app/worker globs inside its own folder only.",
            },
            {
                selector:
                    "CallExpression[callee.object.type='MetaProperty']" +
                    "[callee.property.name='glob'] > TemplateLiteral",
                message: "src/app/worker globs with a plain string only.",
            },
        ],
    },
}));

export default tseslint.config(
    // Hidden directories hold local tooling state, never source to lint.
    {
        ignores: [
            "dist",
            "node_modules",
            "test-results",
            "playwright-report",
            "coverage",
            "**/.*/",
        ],
    },
    js.configs.recommended,
    tseslint.configs.recommended,
    {
        files: ["**/*.{ts,tsx}"],
        plugins: { "react-hooks": reactHooks },
        rules: {
            ...reactHooks.configs.recommended.rules,
            "@typescript-eslint/consistent-type-imports": "error",
        },
    },
    {
        files: ["*.config.{js,ts}", "tests/unit/**", "tests/e2e/*.ts"],
        languageOptions: { globals: globals.node },
    },
    {
        files: ["src/**/*.{ts,tsx}"],
        ignores: ["src/engine/**", "src/core/**"],
        rules: { "no-restricted-imports": ["error", { patterns: [ngne, spriteCore] }] },
    },
    {
        files: ["src/engine/**/*.{ts,tsx}"],
        rules: { "no-restricted-imports": ["error", { patterns: [spriteCore] }] },
    },
    {
        files: ["src/core/**/*.{ts,tsx}"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        ngne,
                        {
                            group: ["react", "react/*", "react-dom", "react-dom/*"],
                            message: "src/core does not import React (SPEC §5).",
                        },
                        {
                            regex: "(^|/)(app|engine|ui)(/|$)",
                            message: "src/core imports nothing from outside src/core (SPEC §5).",
                        },
                    ],
                },
            ],
            "no-restricted-globals": [
                "error",
                ...domGlobals.map((name) => ({
                    name,
                    message: "src/core uses no DOM global (SPEC §5).",
                })),
            ],
        },
    },
    ...spriteSubtree,
    ...workerFolder,
);
