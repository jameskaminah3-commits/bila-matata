// src/bootstrap-env.ts
//
// Loaded first by the server: reads and checks the configuration.

import "dotenv/config";
import { loadConfig } from "./config.ts";

export const platformConfig = loadConfig();
