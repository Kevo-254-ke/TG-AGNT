"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startMemoryMonitor = startMemoryMonitor;
const logger_1 = require("../core/logger");
const log = logger_1.logger.child({ module: 'utils:memoryMonitor' });
/**
 * Periodically logs heap usage and warns past `maxMemoryMb` — useful on
 * Termux where total device RAM is often 2-4GB shared with everything
 * else. This only observes and logs; it doesn't kill the process, since
 * a false-positive restart is worse than a logged warning for a personal
 * bot. Wire an actual restart policy (pm2 max_memory_restart) at the
 * process-supervisor level instead — see ecosystem.config.js.
 */
function startMemoryMonitor(maxMemoryMb, intervalMs = 60_000) {
    return setInterval(() => {
        const heapUsedMb = process.memoryUsage().heapUsed / 1024 / 1024;
        if (heapUsedMb > maxMemoryMb) {
            log.warn({ heapUsedMb: heapUsedMb.toFixed(1), maxMemoryMb }, 'Heap usage above configured threshold');
        }
        else {
            log.debug({ heapUsedMb: heapUsedMb.toFixed(1) }, 'Memory check');
        }
    }, intervalMs);
}
//# sourceMappingURL=memoryMonitor.js.map