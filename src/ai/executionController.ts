import { v4 as uuidv4 } from 'uuid';
import { logger } from '../core/logger';
import type {
  AIResponse,
  ChatMessage,
  ExecutionMetadata,
  ExecutionResult,
  TerminationReason,
  ToolCall,
  ToolDefinition,
  ToolExecutionRecord,
  ToolExecutionResult,
} from '../core/types';
import type { AIFallbackRouter } from './fallbackRouter';
import { TOOL_SCHEMAS } from './toolSchemas';
import type { ToolRegistry } from '../tools/toolRegistry';
import { CancellationToken, CancellationError } from './cancellation';

const log = logger.child({ module: 'ai:executionController' });

export interface ExecutionControllerDeps {
  ai: AIFallbackRouter;
  tools: ToolRegistry;
}

export interface ExecutionControllerOptions {
  maxIterations?: number;
  maxToolCallsPerStep?: number;
  toolTimeoutMs?: number;
}

export interface RunParams {
  messages: ChatMessage[];
  userId: string;
  maxIterations?: number;
  maxToolCallsPerStep?: number;
  toolTimeoutMs?: number;
  onToolCall?: (toolCall: ToolCall) => Promise<void> | void;
  cancellationToken?: CancellationToken;
}

/**
 * Robust execution controller around the AI tool-calling loop.
 *
 * Responsibilities:
 *   - Enforce iteration limits (prevent infinite loops)
 *   - Enforce per-step tool call limits (prevent model abuse)
 *   - Time out individual tool executions (prevent hangs)
 *   - Support user cancellation via CancellationToken
 *   - Track structured execution metadata
 *   - Return clear termination reasons
 *   - Log execution flow without leaking secrets or file contents
 *
 * The controller is provider-agnostic — OpenRouter, Groq, and future
 * providers all use the same execution system.
 */
export class ExecutionController {
  constructor(
    private readonly deps: ExecutionControllerDeps,
    private readonly defaults: ExecutionControllerOptions = {},
  ) {}

  async run(params: RunParams): Promise<ExecutionResult> {
    const executionId = uuidv4();
    const startTime = Date.now();
    const startIso = new Date(startTime).toISOString();

    const maxIterations = params.maxIterations ?? this.defaults.maxIterations ?? 8;
    const maxToolCallsPerStep = params.maxToolCallsPerStep ?? this.defaults.maxToolCallsPerStep ?? 10;
    const toolTimeoutMs = params.toolTimeoutMs ?? this.defaults.toolTimeoutMs ?? 30_000;

    log.info(
      { executionId, userId: params.userId, maxIterations, maxToolCallsPerStep, toolTimeoutMs },
      'Execution started',
    );

    const messages: ChatMessage[] = [...params.messages];
    const toolRecords: ToolExecutionRecord[] = [];
    let lastResponse: AIResponse | null = null;
    let terminationReason: TerminationReason = 'success';

    try {
      for (let iteration = 1; iteration <= maxIterations; iteration++) {
        params.cancellationToken?.throwIfCancelled();

        log.debug({ executionId, iteration }, 'Requesting AI response');
        const response = await this.deps.ai.chat(messages, TOOL_SCHEMAS);
        lastResponse = response;

        log.debug(
          { executionId, iteration, provider: response.provider, model: response.model, toolCallCount: response.toolCalls.length },
          'AI response received',
        );

        if (response.toolCalls.length === 0) {
          terminationReason = 'success';
          log.info({ executionId, iterations: iteration, terminationReason }, 'Execution complete — no tool calls');
          return this.buildResult(
            response.content,
            toolRecords,
            executionId,
            params.userId,
            startTime,
            startIso,
            iteration,
            response.provider,
            response.model,
            terminationReason,
          );
        }

        // Guardrail: max tool calls per iteration
        if (response.toolCalls.length > maxToolCallsPerStep) {
          terminationReason = 'max_tool_calls_per_step';
          const warning = `Too many tool calls in one turn (${response.toolCalls.length} > ${maxToolCallsPerStep}). Please break your request into smaller steps.`;
          log.warn(
            { executionId, iteration, toolCallCount: response.toolCalls.length, maxToolCallsPerStep },
            'Hit max tool calls per step',
          );
          return this.buildResult(
            warning,
            toolRecords,
            executionId,
            params.userId,
            startTime,
            startIso,
            iteration,
            response.provider,
            response.model,
            terminationReason,
          );
        }

        // Echo assistant's tool_calls request into history (OpenAI protocol requirement)
        messages.push({
          role: 'assistant',
          content: response.content || null,
          tool_calls: response.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        });

        for (const toolCall of response.toolCalls) {
          params.cancellationToken?.throwIfCancelled();

          if (params.onToolCall) {
            await params.onToolCall(toolCall);
          }

          const toolStart = Date.now();
          let result: ToolExecutionResult;

          try {
            result = await this.executeWithTimeout(toolCall, params.userId, toolTimeoutMs);
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            result = { success: false, message: `⚠️ Tool execution failed: ${reason}` };
            log.warn({ executionId, tool: toolCall.name, reason }, 'Tool execution error');
          }

          const toolDuration = Date.now() - toolStart;
          toolRecords.push({ toolCall, result, durationMs: toolDuration });

          log.debug(
            { executionId, tool: toolCall.name, success: result.success, durationMs: toolDuration },
            'Tool executed',
          );

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: toolCall.name,
            content: `${result.success ? 'OK' : 'ERROR'}: ${result.message}`,
          });
        }
      }

      // Loop exited because maxIterations was reached
      terminationReason = 'max_iterations';
      log.warn({ executionId, maxIterations }, 'Execution hit iteration limit');
      return this.buildResult(
        lastResponse?.content ||
          "I made some progress but hit my step limit for this turn — let me know if you'd like me to keep going.",
        toolRecords,
        executionId,
        params.userId,
        startTime,
        startIso,
        maxIterations,
        lastResponse?.provider ?? 'unknown',
        lastResponse?.model ?? 'unknown',
        terminationReason,
      );
    } catch (err) {
      if (err instanceof CancellationError) {
        terminationReason = 'cancelled';
        log.info({ executionId, reason: err.message }, 'Execution cancelled');
        return this.buildResult(
          '⏹️ Execution stopped by user.',
          toolRecords,
          executionId,
          params.userId,
          startTime,
          startIso,
          toolRecords.length > 0 ? Math.max(1, Math.ceil(toolRecords.length / Math.max(1, (lastResponse?.toolCalls.length ?? 1)))) : 1,
          lastResponse?.provider ?? 'unknown',
          lastResponse?.model ?? 'unknown',
          terminationReason,
        );
      }

      // Provider failure
      terminationReason = 'provider_failure';
      const reason = err instanceof Error ? err.message : String(err);
      log.error({ executionId, err: reason }, 'Provider failure during execution');
      return this.buildResult(
        `❌ I encountered a problem reaching the AI providers: ${reason}`,
        toolRecords,
        executionId,
        params.userId,
        startTime,
        startIso,
        toolRecords.length > 0 ? Math.max(1, Math.ceil(toolRecords.length / Math.max(1, (lastResponse?.toolCalls.length ?? 1)))) : 1,
        lastResponse?.provider ?? 'unknown',
        lastResponse?.model ?? 'unknown',
        terminationReason,
      );
    }
  }

  private async executeWithTimeout(
    toolCall: ToolCall,
    userId: string,
    timeoutMs: number,
  ): Promise<ToolExecutionResult> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Tool ${toolCall.name} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.deps.tools
        .execute(toolCall.name, toolCall.arguments, userId)
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  private buildResult(
    finalContent: string,
    toolRecords: ToolExecutionRecord[],
    executionId: string,
    userId: string,
    startTime: number,
    startIso: string,
    iterations: number,
    providerUsed: string,
    modelUsed: string,
    terminationReason: TerminationReason,
  ): ExecutionResult {
    const endTime = Date.now();
    const successful = toolRecords.filter((r) => r.result.success).length;
    const failed = toolRecords.filter((r) => !r.result.success).length;

    const metadata: ExecutionMetadata = {
      executionId,
      userId,
      startTime: startIso,
      endTime: new Date(endTime).toISOString(),
      durationMs: endTime - startTime,
      iterations,
      totalToolCalls: toolRecords.length,
      successfulToolCalls: successful,
      failedToolCalls: failed,
      providerUsed,
      modelUsed,
      terminationReason,
      toolRecords,
    };

    log.info(
      {
        executionId,
        durationMs: metadata.durationMs,
        iterations,
        totalToolCalls: toolRecords.length,
        successful,
        failed,
        providerUsed,
        terminationReason,
      },
      'Execution finished',
    );

    return {
      finalContent,
      steps: toolRecords.map((r) => ({ toolCall: r.toolCall, result: r.result })),
      metadata,
      terminationReason,
    };
  }
}
