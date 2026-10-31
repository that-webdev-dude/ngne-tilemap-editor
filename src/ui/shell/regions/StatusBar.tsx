import { useSession } from "../../../app/state/session";
import { useStatus } from "../../../app/state/status";
import { runCommand } from "../../commands/runCommand";
import { useCommands } from "../../commands/useCommands";
import { statusFields } from "../../status/statusFields";
import "../../status/status.css";

/**
 * Status bar content (DESIGN §8.7), left to right the registered fields (`*.status.ts`), then
 * the active tool's modifier hint or transient feedback on the right. A field without text is
 * not rendered, unless it reserves its width so the fields after it keep their place. A field's
 * action ("Fit" after the zoom) is a control, not a field, so it carries no `data-status`.
 */
export function StatusBar() {
    const { session } = useSession((state) => state);
    const cursor = useStatus((state) => state.cursor);
    const hint = useStatus((state) => state.hint);
    const feedback = useStatus((state) => state.feedback);
    const commands = useCommands();
    const map = session.project.maps.find((each) => each.id === session.activeMapId) ?? null;
    const input = { session, map, cursor };
    const message = feedback ?? hint ?? "";
    return (
        <>
            {statusFields.flatMap((field) => {
                const text = field.text(input);
                if (!text && field.reserve === undefined) return [];
                const shown = [
                    <span
                        key={field.id}
                        className="status-field"
                        data-status={field.id}
                        style={field.reserve ? { minWidth: `${field.reserve}ch` } : undefined}
                    >
                        {text}
                    </span>,
                ];
                const action = field.action
                    ? commands.find((command) => command.id === field.action?.commandId)
                    : undefined;
                if (text && field.action && action) {
                    shown.push(
                        <button
                            key={field.action.commandId}
                            type="button"
                            className="status-action"
                            data-status-action={field.id}
                            disabled={!action.enabled()}
                            onClick={() => runCommand(field.action!.commandId)}
                        >
                            {action.title()}
                        </button>,
                    );
                }
                return shown;
            })}
            {message ? (
                <span
                    className="status-message"
                    data-status="message"
                    data-kind={feedback ? "feedback" : "hint"}
                >
                    {message}
                </span>
            ) : null}
        </>
    );
}
