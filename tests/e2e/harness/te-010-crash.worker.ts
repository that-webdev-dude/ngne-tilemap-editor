import { serve } from "../../../src/app/worker/serve";
import type { WorkerScope } from "../../../src/app/worker/serve";
import type { WorkerTask } from "../../../src/app/worker/task";
import { workerTasks } from "../../../src/app/worker/taskTable";

// TE-010 E2E: the background worker with one more task, `test.crash`, which throws outside any
// task, as a worker that fails does: the page gets the worker's `error` event and no answer.
const crash: WorkerTask = {
    name: "test.crash",
    run() {
        setTimeout(() => {
            throw new Error("TE-010 deliberate crash");
        });
        return new Promise<never>(() => {});
    },
};

serve(self as unknown as WorkerScope, new Map([...workerTasks, [crash.name, crash]]));
