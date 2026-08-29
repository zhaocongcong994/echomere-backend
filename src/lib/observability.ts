import { createJsonLogger } from "./logger.js";
import { ServiceMetrics } from "./metrics.js";

export const backendLogger = createJsonLogger();
export const backendMetrics = new ServiceMetrics();
