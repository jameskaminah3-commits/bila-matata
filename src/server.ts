// src/server.ts
//
// Entry point. bootstrap-env.ts must stay the first import: it reads and
// checks the configuration before anything else loads.

import { platformConfig } from "./bootstrap-env.ts";
import { startServer } from "./app.ts";

const { stop } = await startServer(platformConfig);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    console.log(`[platform] ${signal}: shutting down`);
    stop().then(() => process.exit(0), () => process.exit(1));
  });
}
