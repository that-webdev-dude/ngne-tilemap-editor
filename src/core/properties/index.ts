// Custom properties (SPEC §9; TE-040): the type conversions of Change Type, the commands that
// add, rename, retype, set and remove a property on every item of a target, and the built-in
// fields of the Properties panel that no other module sets (project name and export name, tile
// class).

export {
    BUILTIN_LABELS,
    projectFieldProblems,
    setProjectFieldsCommand,
    setTilesClassCommand,
} from "./builtinFields";
export type { ProjectFields } from "./builtinFields";
export {
    PROPERTY_TYPES,
    convertProperty,
    defaultProperty,
    propertyNameProblem,
    propertyValueProblem,
    sameValue,
} from "./convert";
export {
    PROPERTY_LABELS,
    PropertyEditError,
    addPropertyCommand,
    changePropertyTypeCommand,
    commonProperties,
    propertyOwners,
    removePropertyCommand,
    renamePropertyCommand,
    setPropertyValueCommand,
} from "./propertyCommands";
export type {
    CommonProperty,
    PropertyOwner,
    PropertyEditErrorCode,
    PropertyTarget,
} from "./propertyCommands";
