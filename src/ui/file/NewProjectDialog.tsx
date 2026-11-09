import { useId, useState } from "react";
import type { NewProjectRequest, NewProjectValues } from "../../app/file/dialogs";
import type { NewMapValues } from "../../core/maps";
import { MAX_TEXT_LENGTH } from "../../core/model";
import { NewMapFields } from "../maps/NewMapDialog";
import { Button } from "../primitives/Button";
import { Dialog } from "../primitives/Dialog";
import "../primitives/field.css";
import "../maps/mapDialogs.css";
import "./file.css";

/**
 * New Project (DESIGN §9): the project's name, then the New Map fields of its first map. As
 * New Map, a value out of range is shown with its message, and Create is disabled until every
 * value is accepted.
 */
export function NewProjectDialog({ request }: { request: NewProjectRequest }) {
    const [values, setValues] = useState<NewProjectValues>(request.initial);
    const formId = useId();
    const nameId = useId();
    const problems = request.problems(values);
    const { projectName, ...mapProblems } = problems;
    const messages = [...new Set(Object.values(problems))];
    const valid = messages.length === 0;
    const changeMap = (patch: Partial<NewMapValues>) =>
        setValues((current) => ({ ...current, map: { ...current.map, ...patch } }));

    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) request.answer(null);
            }}
            title="New Project"
            actions={
                <>
                    <Button onClick={() => request.answer(null)}>Cancel</Button>
                    <Button
                        variant="primary"
                        type="submit"
                        form={formId}
                        disabled={!valid}
                        data-new-project-create=""
                    >
                        Create
                    </Button>
                </>
            }
        >
            <form
                id={formId}
                className="map-form"
                noValidate
                onSubmit={(event) => {
                    event.preventDefault();
                    if (valid) request.answer(values);
                }}
            >
                <label className="ui-field__label" htmlFor={nameId}>
                    Project name
                </label>
                <input
                    id={nameId}
                    className="map-form__text"
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={MAX_TEXT_LENGTH}
                    aria-invalid={projectName !== undefined || undefined}
                    data-project-field="name"
                    value={values.name}
                    onChange={(event) => {
                        const name = event.target.value;
                        setValues((current) => ({ ...current, name }));
                    }}
                />
                <p className="new-project__section">First map</p>
                <NewMapFields values={values.map} problems={mapProblems} onChange={changeMap} />
                <div className="map-form__messages" role="alert">
                    {messages.map((message) => (
                        <p key={message} className="map-form__message" data-map-problem="">
                            {message}
                        </p>
                    ))}
                </div>
            </form>
        </Dialog>
    );
}
