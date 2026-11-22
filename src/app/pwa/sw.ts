import { installServiceWorker } from "@ngne/editor-ui/pwa/worker";
import type { PrecacheEntry } from "@ngne/editor-ui/pwa/worker";

// TE-066: the app's service worker. `vite build` compiles this file on its own into `sw.js`
// beside `index.html` and puts the list of the build's files where `self.__WB_MANIFEST` stands
// (vite-plugin-pwa, `injectManifest`); the dev server has no worker. The worker itself is the
// package's (@ngne/editor-ui SPEC §10): it precaches the build, removes this editor's older
// caches once no window runs them, and answers the app's requests from the caches. Its names
// come from the editor's id, as `src/app/editorUi.ts` and `src/main.tsx` give it.

installServiceWorker({
    id: "ngne-tilemap-editor",
    // The build replaces `self.__WB_MANIFEST`, written exactly so, with the list of its files.
    manifest: (self as unknown as { __WB_MANIFEST: PrecacheEntry[] }).__WB_MANIFEST,
});
