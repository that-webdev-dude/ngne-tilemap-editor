// Declares `import.meta.glob` wherever this module is compiled.
import type {} from "../../import-meta";
import { collectTasks } from "./task";
import type { TaskModule } from "./task";

/** Every task of the background worker: the `tasks` of each `*.task.ts` module (task.ts). */
export const workerTasks = collectTasks(
    import.meta.glob<TaskModule>("./**/*.task.ts", { eager: true }),
);
