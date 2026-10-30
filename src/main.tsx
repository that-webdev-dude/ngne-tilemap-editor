import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
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
