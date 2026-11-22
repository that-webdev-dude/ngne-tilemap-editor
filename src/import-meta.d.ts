// `types: []` leaves out Vite's client declarations; the parts of `import.meta` the app uses are
// declared here. The app program includes this file through `src`. A module that is also
// compiled outside it (imported by a unit test) adds `import type {} from ".../import-meta"`.
declare global {
    interface ImportMetaEnv {
        readonly DEV: boolean;
        readonly PROD: boolean;
        /** Vite's `base`: where the app, its manifest and its service worker are served. */
        readonly BASE_URL: string;
        /** True in a build, which has the service worker beside it (vite.config.ts, TE-066). */
        readonly SERVICE_WORKER: boolean;
        /**
         * The build facts the About dialog shows: package.json name, version and licence, and
         * the engine package with the version it pins (vite.config.ts, `appInfoDefines`).
         */
        readonly APP_PACKAGE: string;
        readonly APP_VERSION: string;
        readonly APP_LICENSE: string;
        readonly ENGINE_PACKAGE: string;
        readonly ENGINE_VERSION: string;
    }

    interface ImportMeta {
        readonly env: ImportMetaEnv;
        glob<Module>(pattern: string, options: { eager: true }): Record<string, Module>;
    }
}

export {};
