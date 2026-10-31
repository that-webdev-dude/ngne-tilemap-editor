// A toolkit for the page, sent through `page.addInitScript` before the app's scripts run: it
// wraps `GPUAdapter.requestDevice` as the sprite editor's se-011 toolkit did, so a test can
// lose the renderer's device the way a driver reset does, make the next devices fail, and count
// the devices the page asked for (TE-013: recovery, failure, one renderer across resizes).

export interface DeviceToolkit {
    /** Devices the page has been given. */
    created(): number;
    /** Devices that were not destroyed or lost. */
    live(): number;
    /** `destroy()` on the newest live device. */
    loseDevice(): void;
    /** Makes the next `count` `requestDevice` calls reject. */
    refuseDevices(count: number): void;
}

declare global {
    interface Window {
        __te013Devices: DeviceToolkit;
    }
}

interface DeviceLike {
    destroy(): void;
    readonly lost: Promise<unknown>;
}
interface AdapterLike {
    requestDevice(...args: unknown[]): Promise<DeviceLike>;
}
interface GpuScope {
    GPUAdapter?: { prototype: AdapterLike };
}

/** Runs in the page before its scripts. Self-contained: it is sent as source text. */
export function installDeviceToolkit(): void {
    const scope = globalThis as unknown as GpuScope;
    const devices: { device: DeviceLike; live: boolean }[] = [];
    let refuse = 0;
    const adapter = scope.GPUAdapter?.prototype;
    if (adapter) {
        const original = adapter.requestDevice;
        adapter.requestDevice = async function (this: AdapterLike, ...args: unknown[]) {
            if (refuse > 0) {
                refuse -= 1;
                throw new Error("te-013: requestDevice refused");
            }
            const device = await original.apply(this, args);
            const entry = { device, live: true };
            const destroy = device.destroy.bind(device);
            device.destroy = () => {
                entry.live = false;
                destroy();
            };
            void device.lost.then(() => {
                entry.live = false;
            });
            devices.push(entry);
            return device;
        };
    }
    window.__te013Devices = {
        created: () => devices.length,
        live: () => devices.filter((entry) => entry.live).length,
        loseDevice() {
            const newest = [...devices].reverse().find((entry) => entry.live);
            if (!newest) throw new Error("te-013: no live device to lose");
            newest.device.destroy();
        },
        refuseDevices(count) {
            refuse = count;
        },
    };
}
