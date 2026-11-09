// TE-052: the fixture game of the compile matrix (SPEC 11.4). One source, game.ts, imports the
// engine as `@ngne/core`; the compat script writes it into each engine folder with that folder's
// engine package name (`ngne` for 0.1.0), beside the generated `ngne-tilemap.ts`.

/** The engine package name game.ts imports. */
export const GAME_ENGINE = "@ngne/core";

const IMPORT = `from "${GAME_ENGINE}";`;

/** The fixture game `source` importing the engine from the package `engine`. */
export function fixtureGame(source: string, engine: string): string {
    if (!source.includes(IMPORT))
        throw new Error(`The fixture game does not import ${GAME_ENGINE}.`);
    return source.replace(IMPORT, `from "${engine}";`);
}
