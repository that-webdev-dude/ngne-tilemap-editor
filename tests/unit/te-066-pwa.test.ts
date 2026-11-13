import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ICONS, ICONS_DIR, drawIcon, iconPng, pwaColours } from "../../scripts/icons";
import {
    CACHE_PREFIX,
    SKIP_WAITING,
    cacheName,
    cacheable,
    mayDeleteStale,
    olderFile,
    precacheUrls,
    route,
    searchOrder,
    staleCaches,
    uniqueEntries,
} from "../../src/app/pwa/precache";
import type { PrecacheEntry } from "../../src/app/pwa/precache";
import { installLaunchQueue, launchedFile, launchedProject } from "../../src/app/pwa/launchQueue";
import type { LaunchTarget } from "../../src/app/pwa/launchQueue";
import type { ChosenFile } from "../../src/app/platform/projectFiles";
import { RELOAD_KEPT_MS, registerAppUpdates } from "../../src/app/pwa/updates";
import { showUpdateToast, UPDATE_MESSAGE } from "../../src/ui/pwa/updateToast";
import type { ContainerLike, RegistrationLike, WorkerLike } from "../../src/app/pwa/updates";
import { createToastService, INFO_TOAST_MS } from "../../src/ui/toast/toast";
import { manifest } from "../../vite.config";

// TE-066: the parts of the installable app that run without a browser: the web manifest, the
// service worker's cache and routing rules, the page's update flow over a fake service worker
// container, the toast with an action, the icons (the committed files are the generator's
// output) and the launch queue.

const SCOPE = "https://example.test/sub/path/";
const ENTRIES: PrecacheEntry[] = [
    { url: "index.html", revision: "a1" },
    { url: "assets/index-abc.js", revision: null },
    { url: "manifest.webmanifest", revision: "m1" },
    { url: "assets/index-abc.js", revision: null },
];

describe("web manifest (vite.config.ts, SUITE §1 and §7)", () => {
    it("names the app and takes its colours from the design tokens", () => {
        expect(manifest).toMatchObject({
            id: "./",
            start_url: "./",
            scope: "./",
            name: "NGNE Tilemap Editor",
            short_name: "NGNE Tilemaps",
            description: "Tile map editor rendered by the NGNE engine",
            display: "standalone",
            theme_color: "#18181a",
            background_color: "#0f0f10",
        });
        const colours = pwaColours();
        expect([manifest.theme_color, manifest.background_color]).toEqual([
            colours.theme,
            colours.background,
        ]);
    });

    it("lists the four generated icons, any and maskable", () => {
        expect(manifest.icons).toEqual(
            ICONS.map((spec) => ({
                src: `icons/${spec.file}`,
                sizes: `${spec.size}x${spec.size}`,
                type: "image/png",
                purpose: spec.purpose,
            })),
        );
    });

    it("opens .ngtilemap files and focuses an open window", () => {
        expect(manifest.file_handlers).toEqual([
            { action: "./", accept: { "application/x-ngtilemap": [".ngtilemap"] } },
        ]);
        expect(manifest.launch_handler.client_mode[0]).toBe("focus-existing");
    });

    it("links the favicon from index.html", () => {
        const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
        expect(html).toContain('<link rel="icon" type="image/png" href="/icons/icon-192.png" />');
    });
});

describe("service worker precache (src/app/pwa/precache.ts)", () => {
    it("prefixes its caches and messages with the app's name (SUITE §7)", () => {
        expect(CACHE_PREFIX).toBe("ngne-tilemap-editor-");
        expect(SKIP_WAITING).toBe("ngne-tilemap-editor:skip-waiting");
        expect(cacheName(ENTRIES)).toMatch(/^ngne-tilemap-editor-[0-9a-f]{8}$/);
    });

    it("keeps each URL once, the first entry", () => {
        expect(uniqueEntries(ENTRIES)).toEqual(ENTRIES.slice(0, 3));
    });

    it("names one cache per build, the same name for the same build", () => {
        const name = cacheName(ENTRIES);
        expect(name.startsWith(CACHE_PREFIX)).toBe(true);
        expect(cacheName([...ENTRIES])).toBe(name);
        const changed = [{ url: "index.html", revision: "a2" }, ...ENTRIES.slice(1)];
        expect(cacheName(changed)).not.toBe(name);
    });

    it("resolves the entries in the worker's scope, the app's base", () => {
        expect(precacheUrls(ENTRIES.slice(0, 2), SCOPE)).toEqual([
            "https://example.test/sub/path/index.html",
            "https://example.test/sub/path/assets/index-abc.js",
        ]);
    });

    it("deletes only its own older caches", () => {
        const current = cacheName(ENTRIES);
        // The sprite editor shares the origin on GitHub Pages (SUITE §7): its caches stay.
        const names = [current, `${CACHE_PREFIX}00000000`, "ngne-sprite-editor-12345678"];
        expect(staleCaches([...names, "other-app"], current)).toEqual([`${CACHE_PREFIX}00000000`]);
    });

    it("answers navigations to the app with the cached shell and build files from the cache", () => {
        const precached = new Set(precacheUrls(uniqueEntries(ENTRIES), SCOPE));
        const shell = { cached: `${SCOPE}index.html` };
        const get = (url: string, mode = "cors") =>
            route({ url, method: "GET", mode }, SCOPE, precached);
        expect(get(SCOPE, "navigate")).toEqual(shell);
        expect(get(`${SCOPE}?from=launch#x`, "navigate")).toEqual(shell);
        expect(get(`${SCOPE}index.html`, "navigate")).toEqual(shell);
        expect(get(`${SCOPE}assets/index-abc.js`)).toEqual({
            cached: `${SCOPE}assets/index-abc.js`,
        });
        // Not the app's: the network, as without a worker.
        expect(get(`${SCOPE}other.html`, "navigate")).toBeNull();
        expect(get("https://example.test/", "navigate")).toBeNull();
        expect(get(`${SCOPE}assets/missing.js`)).toBeNull();
        expect(
            route({ url: `${SCOPE}index.html`, method: "POST", mode: "cors" }, SCOPE, precached),
        ).toBeNull();
    });

    it("looks for a file in its own cache, then the older ones, newest first", () => {
        const current = `${CACHE_PREFIX}cccccccc`;
        const names = [`${CACHE_PREFIX}aaaaaaaa`, "other-app", current, `${CACHE_PREFIX}bbbbbbbb`];
        expect(searchOrder(names, current)).toEqual([
            current,
            `${CACHE_PREFIX}bbbbbbbb`,
            `${CACHE_PREFIX}aaaaaaaa`,
        ]);
        expect(searchOrder([current], current)).toEqual([current]);
    });

    it("looks for a file of the scope that is not this build's in the older caches (a window of an older deployment)", () => {
        const precached = new Set(precacheUrls(uniqueEntries(ENTRIES), SCOPE));
        const older = (url: string, mode = "cors", method = "GET") =>
            olderFile({ url, method, mode }, SCOPE, precached);
        // An older deployment's chunk or web worker script: not in this build.
        expect(older(`${SCOPE}assets/importWorker-old.js`)).toBe(
            `${SCOPE}assets/importWorker-old.js`,
        );
        expect(older(`${SCOPE}assets/old.js#x`)).toBe(`${SCOPE}assets/old.js`);
        // This build's files are `route`'s; navigations, other methods and other places are
        // the network's.
        expect(older(`${SCOPE}assets/index-abc.js`)).toBeNull();
        expect(older(`${SCOPE}assets/old.js`, "navigate")).toBeNull();
        expect(older(`${SCOPE}assets/old.js`, "cors", "POST")).toBeNull();
        expect(older("https://example.test/elsewhere/old.js")).toBeNull();
        expect(older("https://other.test/sub/path/old.js")).toBeNull();
    });

    it("keeps the older caches while a window open when it took over is still there", () => {
        // The single window reloaded: its new page is no older window.
        expect(mayDeleteStale(["new-page"], ["old-page"])).toBe(true);
        expect(mayDeleteStale([], ["old-page"])).toBe(true);
        expect(mayDeleteStale([], [])).toBe(true);
        // A second window still runs the older deployment.
        expect(mayDeleteStale(["new-page", "second-window"], ["old-page", "second-window"])).toBe(
            false,
        );
    });

    it("rebuilds a redirected response before it is cached and keeps any other", async () => {
        const plain = new Response("x", { status: 200 });
        expect(await cacheable(plain)).toBe(plain);
        const redirected = {
            redirected: true,
            status: 200,
            statusText: "OK",
            headers: new Headers({ "content-type": "text/html" }),
            blob: async () => new Blob(["<!doctype html>"]),
        };
        const rebuilt = await cacheable(redirected);
        expect(rebuilt).toBeInstanceOf(Response);
        expect(rebuilt.redirected).toBe(false);
        expect(rebuilt.status).toBe(200);
        expect(rebuilt.statusText).toBe("OK");
        expect(rebuilt.headers.get("content-type")).toBe("text/html");
        expect(await (rebuilt as Response).text()).toBe("<!doctype html>");
    });
});

/** A fake `ServiceWorker` whose state the test moves on. */
class FakeWorker implements WorkerLike {
    state = "installing";
    messages: unknown[] = [];
    private listeners: (() => void)[] = [];
    postMessage(message: unknown) {
        this.messages.push(message);
    }
    addEventListener(_type: "statechange", listener: () => void) {
        this.listeners.push(listener);
    }
    become(state: string) {
        this.state = state;
        for (const listener of this.listeners) listener();
    }
}

class FakeRegistration implements RegistrationLike {
    installing: FakeWorker | null = null;
    waiting: FakeWorker | null = null;
    updates = 0;
    private found: (() => void)[] = [];
    async update() {
        this.updates++;
    }
    addEventListener(_type: "updatefound", listener: () => void) {
        this.found.push(listener);
    }
    /** A new worker starts installing. */
    install(worker: FakeWorker) {
        this.installing = worker;
        for (const listener of this.found) listener();
    }
}

class FakeContainer implements ContainerLike {
    registered: { url: string; scope: string }[] = [];
    private changes: (() => void)[] = [];
    constructor(
        public controller: unknown,
        public registration = new FakeRegistration(),
    ) {}
    async register(url: string, options: { scope: string }) {
        this.registered.push({ url, ...options });
        return this.registration;
    }
    addEventListener(_type: "controllerchange", listener: () => void) {
        this.changes.push(listener);
    }
    /** A new worker controls the page. */
    change(controller: unknown) {
        this.controller = controller;
        for (const listener of this.changes) listener();
    }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("update flow (src/app/pwa/updates.ts)", () => {
    function start(controller: unknown) {
        const container = new FakeContainer(controller);
        const reload = vi.fn();
        const updates = registerAppUpdates({
            container,
            url: "/sub/path/sw.js",
            scope: "/sub/path/",
            reload,
        });
        return { container, registration: container.registration, reload, updates };
    }

    it("registers the worker at the base, and the first visit is no update", async () => {
        const { container, registration, reload, updates } = start(null);
        await flush();
        expect(container.registered).toEqual([{ url: "/sub/path/sw.js", scope: "/sub/path/" }]);
        const worker = new FakeWorker();
        registration.install(worker);
        worker.become("installed");
        worker.become("activated");
        container.change(worker);
        expect(updates.store.getState().ready).toBe(false);
        expect(reload).not.toHaveBeenCalled();
    });

    it("offers a new deployment once its worker waits, and activates it only on apply", async () => {
        const { container, registration, reload, updates } = start({});
        await flush();
        await updates.check();
        expect(registration.updates).toBe(1);
        const worker = new FakeWorker();
        registration.install(worker);
        expect(updates.store.getState().ready).toBe(false);
        worker.become("installed");
        expect(updates.store.getState().ready).toBe(true);
        expect(worker.messages).toEqual([]);

        updates.apply();
        expect(worker.messages).toEqual([{ type: SKIP_WAITING }]);
        expect(reload).not.toHaveBeenCalled();
        container.change(worker);
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it("offers a worker already waiting when the page starts", async () => {
        const container = new FakeContainer({});
        const waiting = new FakeWorker();
        waiting.state = "installed";
        container.registration.waiting = waiting;
        const updates = registerAppUpdates({
            container,
            url: "sw.js",
            scope: "/",
            reload: vi.fn(),
        });
        await flush();
        expect(updates.store.getState().ready).toBe(true);
        updates.apply();
        expect(waiting.messages).toEqual([{ type: SKIP_WAITING }]);
    });

    it("offers a reload when another window applied the update", async () => {
        const { container, reload, updates } = start({});
        await flush();
        container.change({});
        expect(updates.store.getState().ready).toBe(true);
        expect(reload).not.toHaveBeenCalled();
        updates.apply();
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it("offers Reload again when the reload was cancelled (Stay), and reloads nothing without it", async () => {
        vi.useFakeTimers();
        try {
            const { container, registration, reload, updates } = start({});
            const service = createToastService();
            showUpdateToast(updates, service);
            await vi.advanceTimersByTimeAsync(0);
            const worker = new FakeWorker();
            registration.install(worker);
            worker.become("installed");
            const offered = () =>
                service.store.getState().toasts.filter((item) => item.message === UPDATE_MESSAGE);
            expect(offered()).toHaveLength(1);

            // Reload (the toast's action dismisses the toast); the new worker takes over and
            // the page reloads, but the browser's question is answered Stay.
            const [toast] = offered();
            service.dismiss(toast!.id);
            toast!.action!.run();
            expect(worker.messages).toEqual([{ type: SKIP_WAITING }]);
            container.change(worker);
            expect(reload).toHaveBeenCalledTimes(1);
            expect(offered()).toHaveLength(0);

            // The page still runs: Reload is offered again.
            vi.advanceTimersByTime(RELOAD_KEPT_MS);
            expect(updates.store.getState().ready).toBe(true);
            expect(offered()).toHaveLength(1);
            // A later change of worker reloads nothing without the user's choice.
            container.change(new FakeWorker());
            expect(reload).toHaveBeenCalledTimes(1);
            // Reload again reloads (the new worker controls the page already).
            offered()[0]!.action!.run();
            expect(reload).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it("waits once more when the page was held by the browser's question, and offers nothing once the page has gone", async () => {
        vi.useFakeTimers();
        try {
            const { reload, updates } = start({});
            await vi.advanceTimersByTimeAsync(0);
            // Another window applied the update: Reload just reloads.
            updates.store.setState({ ready: true });
            updates.apply();
            expect(reload).toHaveBeenCalledTimes(1);
            // The question held the page's timers for a while: the check comes late and waits
            // once more, for the page to leave (Leave) or stay.
            vi.setSystemTime(Date.now() + RELOAD_KEPT_MS * 10);
            vi.advanceTimersByTime(RELOAD_KEPT_MS);
            const states: boolean[] = [];
            updates.store.subscribe((state) => states.push(state.ready));
            expect(states).toEqual([]);
            vi.advanceTimersByTime(RELOAD_KEPT_MS);
            expect(states).toEqual([false, true]);
        } finally {
            vi.useRealTimers();
        }
    });

    it("reports a registration that fails and keeps the page as it is", async () => {
        const container = new FakeContainer(null);
        container.register = () => Promise.reject(new Error("no worker"));
        const report = vi.fn();
        const updates = registerAppUpdates({
            container,
            url: "sw.js",
            scope: "/",
            reload: vi.fn(),
            report,
        });
        await updates.check();
        expect(report).toHaveBeenCalledWith(new Error("no worker"));
        expect(updates.store.getState().ready).toBe(false);
    });
});

describe("toast with an action (TE-066)", () => {
    it("keeps an information toast with an action until it is dismissed", () => {
        vi.useFakeTimers();
        try {
            const service = createToastService();
            const run = vi.fn();
            const id = service.info("A new version is ready.", {
                action: { label: "Reload", run },
            });
            vi.advanceTimersByTime(INFO_TOAST_MS * 3);
            const [item] = service.store.getState().toasts;
            expect(item).toMatchObject({ id, kind: "info", action: { label: "Reload" } });
            item!.action!.run();
            expect(run).toHaveBeenCalledTimes(1);
            service.dismiss(id);
            expect(service.store.getState().toasts).toEqual([]);
            // Without an action it still goes after 4 s.
            service.info("Saved");
            vi.advanceTimersByTime(INFO_TOAST_MS);
            expect(service.store.getState().toasts).toEqual([]);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("icons (scripts/icons.ts)", () => {
    it("takes the manifest colours from the design tokens", () => {
        expect(pwaColours()).toEqual({
            theme: "#18181a",
            background: "#0f0f10",
            accent: "#83e8e1",
        });
    });

    it("commits exactly what a fresh run of the generator draws (drift)", () => {
        for (const spec of ICONS) {
            const committed = new Uint8Array(readFileSync(new URL(spec.file, ICONS_DIR)));
            expect(Buffer.from(committed).equals(Buffer.from(iconPng(spec))), spec.file).toBe(true);
        }
    });

    it("draws the 2 × 2 tile grid in the accent colour: its lines and the top-left tile", () => {
        // The 192 icon: 7 × 7 cells of floor(192 × 0.6 / 7) = 16 px from (192 − 112) / 2 = 40;
        // the grid's lines are cell rows and columns 0, 3 and 6.
        const data = drawIcon(ICONS[0]!);
        const at = (x: number, y: number) =>
            Array.from(data.subarray((y * 192 + x) * 4, (y * 192 + x) * 4 + 4));
        const accent = [0x83, 0xe8, 0xe1, 255];
        const panel = [0x18, 0x18, 0x1a, 255];
        // The painted tile and the lines: the frame, the middle row and column.
        for (const [x, y] of [
            [72, 72],
            [44, 120],
            [96, 120],
            [120, 96],
            [147, 147],
        ] as const) {
            expect(at(x, y), `${x},${y}`).toEqual(accent);
        }
        // The three empty tiles.
        for (const [x, y] of [
            [120, 72],
            [72, 120],
            [120, 120],
        ] as const) {
            expect(at(x, y), `${x},${y}`).toEqual(panel);
        }
    });

    it("draws the maskable icons to every edge and the others with transparent corners", () => {
        for (const spec of ICONS) {
            const data = drawIcon(spec);
            const cornerAlpha = data[3];
            expect(cornerAlpha, spec.file).toBe(spec.purpose === "maskable" ? 255 : 0);
            const centre = ((spec.size / 2) * spec.size + spec.size / 2) * 4;
            expect(data[centre + 3], spec.file).toBe(255);
        }
    });
});

describe("launch queue (src/app/pwa/launchQueue.ts)", () => {
    const handle = (name: string, bytes: number[]) => ({
        kind: "file",
        name,
        getFile: async () => new File([Uint8Array.from(bytes)], name),
        createWritable: async () => ({}),
    });

    it("hands launched file handles to the open path as chosen files with their handle", async () => {
        const file = await launchedFile(handle("hero.ngtilemap", [1, 2, 3]));
        expect(file).toMatchObject({ name: "hero.ngtilemap", size: 3 });
        expect(Array.from(await file!.read())).toEqual([1, 2, 3]);
        expect((await file!.handle())?.name).toBe("hero.ngtilemap");
        expect(await launchedFile({ kind: "directory", name: "x" })).toBeNull();
    });

    /** Opens what it is given, busy for each open until `finish` lets it end. */
    function fakeTarget() {
        const opened: string[][] = [];
        const errors: string[] = [];
        const listeners = new Set<() => void>();
        let busy = false;
        let hold = false;
        const finishers: (() => void)[] = [];
        const target: LaunchTarget = {
            canAct: () => !busy,
            subscribe(listener) {
                listeners.add(listener);
                return () => listeners.delete(listener);
            },
            async openFiles(files: readonly ChosenFile[]) {
                if (busy) return false;
                opened.push(files.map((file) => file.name));
                if (!hold) return true;
                setBusy(true);
                await new Promise<void>((resolve) => finishers.push(resolve));
                setBusy(false);
                return true;
            },
            error: (message) => void errors.push(message),
        };
        const setBusy = (value: boolean) => {
            busy = value;
            for (const listener of [...listeners]) listener();
        };
        return {
            target,
            opened,
            errors,
            setBusy,
            holdEachOpen: () => void (hold = true),
            finish: () => finishers.shift()?.(),
        };
    }

    function stubQueue() {
        let consumer: ((params: { files?: unknown[] }) => void) | null = null;
        const queue = { setConsumer: vi.fn((next: typeof consumer) => void (consumer = next)) };
        return { queue, launch: (files: unknown[]) => consumer!({ files }) };
    }

    it("sets the consumer once and keeps launches while no install is there", async () => {
        const { queue, launch } = stubQueue();
        const { target, opened } = fakeTarget();
        const stop = installLaunchQueue({ queue, target });
        launch([handle("a.ngtilemap", [1])]);
        await flush();
        expect(opened).toEqual([["a.ngtilemap"]]);
        stop();
        // While none is installed (React runs an effect's cleanup and the effect again).
        launch([handle("b.ngtilemap", [1]), { kind: "directory", name: "d" }]);
        launch([]);
        await flush();
        expect(opened).toEqual([["a.ngtilemap"]]);
        const again = installLaunchQueue({ queue, target });
        await flush();
        expect(opened).toEqual([["a.ngtilemap"], ["b.ngtilemap"]]);
        expect(queue.setConsumer).toHaveBeenCalledTimes(1);
        again();
    });

    it("opens back-to-back launches one after another, each once the workflows are idle", async () => {
        const { queue, launch } = stubQueue();
        const fake = fakeTarget();
        fake.holdEachOpen();
        const stop = installLaunchQueue({ queue, target: fake.target });
        // Two files opened from the desktop in quick succession.
        launch([handle("first.ngtilemap", [1])]);
        launch([handle("second.ngtilemap", [2])]);
        await flush();
        expect(fake.opened).toEqual([["first.ngtilemap"]]);
        fake.finish();
        await flush();
        expect(fake.opened).toEqual([["first.ngtilemap"], ["second.ngtilemap"]]);
        fake.finish();
        await flush();

        // A launch while another operation runs (a Save picker, an export) waits for its end.
        fake.setBusy(true);
        launch([handle("third.ngtilemap", [3])]);
        await flush();
        expect(fake.opened).toHaveLength(2);
        fake.setBusy(false);
        await flush();
        expect(fake.opened).toEqual([
            ["first.ngtilemap"],
            ["second.ngtilemap"],
            ["third.ngtilemap"],
        ]);
        fake.finish();
        await flush();
        expect(fake.errors).toEqual([]);
        stop();
    });

    it("opens the first project file of a launch as the project (one project per window)", async () => {
        const png = handle("tiles.png", [9]);
        const first = handle("first.ngtilemap", [1]);
        const second = handle("second.ngtilemap", [2]);
        expect(launchedProject([png, first, second])).toBe(first);
        // Without a project file, the first file: `openFiles` reports it as not a project.
        expect(launchedProject([{ kind: "directory", name: "d" }, png])).toBe(png);
        expect(launchedProject([{ kind: "directory", name: "d" }])).toBeNull();
        expect(launchedProject([])).toBeNull();

        const { queue, launch } = stubQueue();
        const fake = fakeTarget();
        const stop = installLaunchQueue({ queue, target: fake.target });
        launch([png, first, second]);
        launch([handle("notes.txt", [3])]);
        await flush();
        await flush();
        expect(fake.opened).toEqual([["first.ngtilemap"], ["notes.txt"]]);
        expect(fake.errors).toEqual([]);
        stop();
    });

    it("reports a launched project file that cannot be read and goes on with the next launch", async () => {
        const { queue, launch } = stubQueue();
        const fake = fakeTarget();
        const stop = installLaunchQueue({ queue, target: fake.target });
        const gone = {
            ...handle("gone.ngtilemap", [1]),
            getFile: async () => {
                throw new DOMException("A requested file could not be found.", "NotFoundError");
            },
        };
        launch([gone, handle("other.ngtilemap", [2])]);
        launch([handle("next.ngtilemap", [3])]);
        await flush();
        await flush();
        expect(fake.opened).toEqual([["next.ngtilemap"]]);
        expect(fake.errors).toEqual([
            "Could not open “gone.ngtilemap”. A requested file could not be found.",
        ]);
        stop();
    });
});
