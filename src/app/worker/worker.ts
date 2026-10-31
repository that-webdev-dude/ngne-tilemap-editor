import { serve } from "./serve";
import type { WorkerScope } from "./serve";
import { workerTasks } from "./taskTable";

// The background worker (SPEC §1): a module worker that imports only `core/` and this folder,
// started by `startModuleWorker` (client.ts).
serve(self as unknown as WorkerScope, workerTasks);
