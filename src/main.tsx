import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

/**
 * The empty root of the scaffold. Once React has committed it, `<html data-app-ready>` tells
 * the E2E helpers that the app has started (`openApp` in tests/e2e/support/wait.ts).
 */
function Root() {
    useEffect(() => {
        document.documentElement.dataset.appReady = "";
    }, []);
    return null;
}

createRoot(root).render(
    <StrictMode>
        <Root />
    </StrictMode>,
);
