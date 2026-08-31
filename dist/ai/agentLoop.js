"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAgentLoop = runAgentLoop;
const logger_1 = require("../core/logger");
const executionController_1 = require("./executionController");
const log = logger_1.logger.child({ module: 'ai:agentLoop' });
/**
 * Backward-compatible wrapper around ExecutionController.
 * Preserves the exact interface the rest of the codebase expects.
 *
 * @deprecated Prefer ExecutionController directly for new code.
 */
async function runAgentLoop(deps, initialMessages, userId) {
    const controller = new executionController_1.ExecutionController({ ai: deps.ai, tools: deps.tools });
    const result = await controller.run({
        messages: initialMessages,
        userId,
        maxIterations: deps.maxIterations,
        onToolCall: deps.onToolCall,
    });
    return {
        finalContent: result.finalContent,
        steps: result.steps,
        iterations: result.metadata.iterations,
        hitStepLimit: result.terminationReason === 'max_iterations',
    };
}
//# sourceMappingURL=agentLoop.js.map