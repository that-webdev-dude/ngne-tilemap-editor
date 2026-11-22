// The package's stylesheet first: the editor's own stylesheets, which its modules import, come
// after it in the page.
import "@ngne/editor-ui/styles.css";
import { registerAppUpdates, showUpdateToast, UPDATE_CHECK_MS } from "@ngne/editor-ui/pwa";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { editorUi } from "./app/editorUi";
import { App } from "./ui/App";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

/**
 * Once React has committed the app, `<html data-app-ready>` tells the E2E helpers that it has
 * started (`openApp` in tests/e2e/support/wait.ts).
 */
function Root() {
    useEffect(() => {
        document.documentElement.dataset.appReady = "";
    }, []);
    return <App />;
}

createRoot(root).render(
    <StrictMode>
        <Root />
    </StrictMode>,
);

// TE-066: a build registers its service worker (src/app/pwa/sw.ts), which keeps the app for
// offline use, and offers Reload when a new deployment is waiting. The dev server has none.
// The worker is registered once the page has loaded, so its download of the whole build does
// not compete with the page's own start.
function startServiceWorker(container: ServiceWorkerContainer): void {
    // The worker that served this page also learns that the page runs its deployment: older
    // caches can go once no window runs an older one (sw.ts).
    const updates = registerAppUpdates({
        id: editorUi.config.id,
        container,
        url: `${import.meta.env.BASE_URL}sw.js`,
        scope: import.meta.env.BASE_URL,
        reload: () => window.location.reload(),
    });
    showUpdateToast(updates);
    // A page left open asks for a new deployment when it is shown again, and every hour.
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void updates.check();
    });
    setInterval(() => void updates.check(), UPDATE_CHECK_MS);
}

if (import.meta.env.SERVICE_WORKER && "serviceWorker" in navigator) {
    const start = () => startServiceWorker(navigator.serviceWorker);
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
}
