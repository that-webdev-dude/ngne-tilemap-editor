import { useStore } from "zustand";
import { openRecentId, recentFiles } from "../../app/file/recentFiles";
import { runCommand } from "../commands/runCommand";
import { useCommands } from "../commands/useCommands";
import { Button } from "../primitives/Button";
import "./emptyState.css";

/** The actions of the empty state, each the command of the same name (DESIGN §3.3). */
const ACTIONS = [
    ["file.newProject", "New Project"],
    ["file.open", "Open"],
    ["file.importTiledMap", "Import Tiled Map"],
] as const;

/**
 * What the workspace shows while no project is open (the sprite editor's DESIGN §6): plain
 * text buttons, centred, no illustration. New Project, Open and Import Tiled Map (enabled once
 * TE-061 implements its command) and, below them, the recent projects, newest first, each
 * opening its file through its File → Open Recent command; nothing of the list shows while it
 * is empty.
 */
export function EmptyState() {
    const entries = useStore(recentFiles.store, (state) => state.entries);
    const commands = useCommands();
    const enabled = (id: string) =>
        commands.find((command) => command.id === id)?.enabled() ?? false;
    return (
        <div className="empty-state" data-empty-state="">
            {ACTIONS.map(([id, label]) => (
                <Button key={id} disabled={!enabled(id)} onClick={() => runCommand(id)}>
                    {label}
                </Button>
            ))}
            {entries.length > 0 ? (
                <>
                    <p className="empty-state__recent-title" id="empty-state-recent">
                        Recent projects
                    </p>
                    <ul className="empty-state__recent" aria-labelledby="empty-state-recent">
                        {entries.map((entry) => (
                            <li key={entry.key}>
                                <Button
                                    data-recent-file={entry.name}
                                    title={entry.name}
                                    onClick={() => runCommand(openRecentId(entry))}
                                >
                                    <span className="empty-state__recent-name">{entry.name}</span>
                                </Button>
                            </li>
                        ))}
                    </ul>
                </>
            ) : null}
        </div>
    );
}
