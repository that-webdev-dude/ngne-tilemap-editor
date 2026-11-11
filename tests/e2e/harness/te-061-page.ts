// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import { createProjectSession } from "../../../src/core/model";
import type { Geometry } from "./te-036-page";

// TE-061 page module: the specs import it into the running editor, so it shares the app's
// stores. After a Tiled map is imported into a new project (its only map), it places the view
// and compares the canvas with the reference of `core/compositor` through TE-036's comparison
// (harness/te-036-page.ts), which draws tile and image layers, groups, opacity, offsets and
// parallax as the live and chunk tiers do.

export { chunksReady, compare } from "./te-036-page";

const hooks = () => window.__ngneTest!;

/** The imported map: its parallax origin and how many tilesets and images the project has. */
export function mapInfo() {
    const { project } = hooks().session.getState().session;
    const map = project.maps[0]!;
    return {
        parallaxOriginX: map.parallaxOriginX,
        parallaxOriginY: map.parallaxOriginY,
        tilesets: project.tilesets.length,
        images: project.images.length,
    };
}

/** Shows the map at `scale` device pixels per map pixel around (centreX, centreY). */
export function placeView(scale: number, centreX: number, centreY: number): Geometry {
    const viewport = hooks().viewport;
    if (!viewport) throw new Error("te-061: no viewport probe");
    const { width, height } = viewport.canvas;
    const state = hooks().session.getState();
    const session = createProjectSession(state.session.project);
    session.perMap.get(session.activeMapId)!.view = {
        centreX,
        centreY,
        zoom: scale / window.devicePixelRatio,
    };
    state.replace(session);
    return { tier: "live", width, height, scale, centreX, centreY };
}

/** Submits a frame and tells whether it drew the image layers' quads, when there are any. */
export function drawn(images: number): boolean {
    const viewport = hooks().viewport!;
    if (!viewport.renderNow()) return false;
    return images === 0 || viewport.stats.imageQuads > 0;
}
