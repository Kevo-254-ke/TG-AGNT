"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAgentLoop = runAgentLoop;
const logger_1 = require("../core/logger");
const toolSchemas_1 = require("./toolSchemas");
const log = logger_1.logger.child({ module: 'ai:agentLoop' });
/**
 * Runs the OpenAI-style function-calling loop to completion instead of a
 * single request/response round.
 *
 * Without this loop, a request like "make three files" reliably stalls
 * after the first one: many models (especially smaller free-tier ones)
 * emit only one tool call per turn and rely entirely on the caller to
 * report the result and ask "what's next?" — a single ai.chat() call
 * has no way to give the model that second turn. Each iteration here
 * appends the assistant's tool-call request and the corresponding tool
 * result(s) back into the conversation, then asks again, until the model
 * responds with no further tool calls (task done) or `maxIterations` is
 * reached (safety cap against a runaway loop).
 */
async function runAgentLoop(deps, initialMessages, userId) {
    const messages = [...initialMessages];
    const steps = [];
    let lastResponse = null;
    for (let iteration = 1; iteration <= deps.maxIterations; iteration++) {
        const response = await deps.ai.chat(messages, toolSchemas_1.TOOL_SCHEMAS);
        lastResponse = response;
        if (response.toolCalls.length === 0) {
            return { finalContent: response.content, steps, iterations: iteration, hitStepLimit: false };
        }
        // Echo the model's own tool-call request back into history — the
        // OpenAI-style protocol requires this exact assistant turn to precede
        // the tool result messages, or the follow-up call is malformed.
        messages.push({
            role: 'assistant',
            content: response.content || null,
            tool_calls: response.toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function',
                function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
            })),
        });
        for (const toolCall of response.toolCalls) {
            if (deps.onToolCall)
                await deps.onToolCall(toolCall);
            const result = await deps.tools.execute(toolCall.name, toolCall.arguments, userId);
            steps.push({ toolCall, result });
            messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                name: toolCall.name,
                content: `${result.success ? 'OK' : 'ERROR'}: ${result.message}`,
            });
        }
    }
    log.warn({ userId, maxIterations: deps.maxIterations }, 'Agent loop hit its step limit without the model finishing');
    return {
        finalContent: lastResponse?.content ||
            "I made some progress but hit my step limit for this turn — let me know if you'd like me to keep going.",
        steps,
        iterations: deps.maxIterations,
        hitStepLimit: true,
    };
}
//# sourceMappingURL=agentLoop.js.map