import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runAgentLoop } from '../../src/ai/agentLoop';
import { AIFallbackRouter } from '../../src/ai/fallbackRouter';
import { ToolRegistry } from '../../src/tools/toolRegistry';
import type { AIProvider, AIResponse, ChatMessage } from '../../src/core/types';

function toolCallResponse(id: string, name: string, args: Record<string, unknown>): AIResponse {
  return {
    content: '',
    toolCalls: [{ id, name, arguments: args }],
    provider: 'fake',
    model: 'fake',
  };
}

function finalResponse(content: string): AIResponse {
  return { content, toolCalls: [], provider: 'fake', model: 'fake' };
}

describe('runAgentLoop', () => {
  let filesDir: string;
  let tools: ToolRegistry;
  const userId = 'user-1';

  beforeEach(async () => {
    filesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentloop-test-'));
    tools = new ToolRegistry(filesDir);
  });

  afterEach(async () => {
    await fs.rm(filesDir, { recursive: true, force: true });
  });

  it('reproduces and fixes the reported bug: a model that requests one file per turn creates all three, not just the first', async () => {
    // Simulates exactly what a real free-tier model does: it returns ONE
    // tool call per response and expects the caller to report the result
    // and ask again — this is what a single ai.chat() call cannot do.
    let call = 0;
    const chat = vi.fn(async (): Promise<AIResponse> => {
      call += 1;
      if (call === 1) return toolCallResponse('1', 'create_file', { filename: 'index.html', content: '<html></html>' });
      if (call === 2) return toolCallResponse('2', 'create_file', { filename: 'style.css', content: 'body {}' });
      if (call === 3) return toolCallResponse('3', 'create_file', { filename: 'script.js', content: 'console.log(1)' });
      return finalResponse('All three files are ready!');
    });
    const provider: AIProvider = { name: 'fake', chat };
    const ai = new AIFallbackRouter([provider]);

    const messages: ChatMessage[] = [{ role: 'user', content: 'Make a calculator using html css and js, three files' }];
    const result = await runAgentLoop({ ai, tools, maxIterations: 8 }, messages, userId);

    expect(chat).toHaveBeenCalledTimes(4); // 3 tool-call turns + 1 final turn
    expect(result.hitStepLimit).toBe(false);
    expect(result.finalContent).toBe('All three files are ready!');
    expect(result.steps.map((s) => s.toolCall.name)).toEqual(['create_file', 'create_file', 'create_file']);
    expect(result.steps.every((s) => s.result.success)).toBe(true);

    const files = await fs.readdir(path.join(filesDir, userId));
    expect(files.sort()).toEqual(['index.html', 'script.js', 'style.css']);
  });

  it('stops immediately when the first response has no tool calls', async () => {
    const chat = vi.fn(async () => finalResponse('Just a text answer, no files needed.'));
    const ai = new AIFallbackRouter([{ name: 'fake', chat } as unknown as AIProvider]);

    const result = await runAgentLoop({ ai, tools, maxIterations: 8 }, [{ role: 'user', content: 'hi' }], userId);

    expect(chat).toHaveBeenCalledTimes(1);
    expect(result.steps).toHaveLength(0);
    expect(result.finalContent).toBe('Just a text answer, no files needed.');
  });

  it('executes multiple tool calls returned in a single response without extra AI round-trips', async () => {
    let call = 0;
    const chat = vi.fn(async (): Promise<AIResponse> => {
      call += 1;
      if (call === 1) {
        return {
          content: '',
          toolCalls: [
            { id: '1', name: 'create_file', arguments: { filename: 'a.txt', content: 'a' } },
            { id: '2', name: 'create_file', arguments: { filename: 'b.txt', content: 'b' } },
          ],
          provider: 'fake',
          model: 'fake',
        };
      }
      return finalResponse('Done');
    });
    const ai = new AIFallbackRouter([{ name: 'fake', chat } as unknown as AIProvider]);

    const result = await runAgentLoop({ ai, tools, maxIterations: 8 }, [{ role: 'user', content: 'make two files' }], userId);

    expect(chat).toHaveBeenCalledTimes(2);
    expect(result.steps).toHaveLength(2);
  });

  it('respects the step-limit safety cap against a model that never stops requesting tools', async () => {
    const chat = vi.fn(async (): Promise<AIResponse> =>
      toolCallResponse('x', 'create_file', { filename: 'loop.txt', content: 'x' }),
    );
    const ai = new AIFallbackRouter([{ name: 'fake', chat } as unknown as AIProvider]);

    const result = await runAgentLoop({ ai, tools, maxIterations: 3 }, [{ role: 'user', content: 'go' }], userId);

    expect(chat).toHaveBeenCalledTimes(3);
    expect(result.hitStepLimit).toBe(true);
    expect(result.iterations).toBe(3);
  });

  it('calls onToolCall before executing each tool, for live status updates', async () => {
    let call = 0;
    const chat = vi.fn(async (): Promise<AIResponse> => {
      call += 1;
      if (call === 1) return toolCallResponse('1', 'create_file', { filename: 'a.txt', content: 'a' });
      return finalResponse('done');
    });
    const ai = new AIFallbackRouter([{ name: 'fake', chat } as unknown as AIProvider]);
    const onToolCall = vi.fn();

    await runAgentLoop({ ai, tools, maxIterations: 8, onToolCall }, [{ role: 'user', content: 'make a file' }], userId);

    expect(onToolCall).toHaveBeenCalledTimes(1);
    expect(onToolCall).toHaveBeenCalledWith(expect.objectContaining({ name: 'create_file' }));
  });

  it('echoes the assistant tool_calls request and tool result back into message history for the next turn', async () => {
    let capturedMessages: ChatMessage[] = [];
    let call = 0;
    const chat = vi.fn(async (messages: ChatMessage[]): Promise<AIResponse> => {
      call += 1;
      capturedMessages = messages;
      if (call === 1) return toolCallResponse('abc', 'create_file', { filename: 'a.txt', content: 'a' });
      return finalResponse('done');
    });
    const ai = new AIFallbackRouter([{ name: 'fake', chat } as unknown as AIProvider]);

    await runAgentLoop({ ai, tools, maxIterations: 8 }, [{ role: 'user', content: 'make a file' }], userId);

    // On the second call, history should include the assistant's tool_calls
    // request and the resulting tool-role message referencing the same id.
    const assistantTurn = capturedMessages.find((m) => m.role === 'assistant' && m.tool_calls);
    const toolTurn = capturedMessages.find((m) => m.role === 'tool');
    expect(assistantTurn?.tool_calls?.[0].id).toBe('abc');
    expect(toolTurn?.tool_call_id).toBe('abc');
    expect(toolTurn?.content).toContain('OK');
  });
});
