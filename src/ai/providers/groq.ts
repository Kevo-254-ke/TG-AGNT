import axios, { AxiosInstance } from 'axios';
import { env } from '../../config/env';
import { logger } from '../../core/logger';
import type { AIProvider, AIResponse, ChatMessage, ToolCall, ToolDefinition } from '../../core/types';
import { describeAxiosError } from './openrouter';

const log = logger.child({ module: 'ai:groq' });

/** Groq client — fast inference, generous free tier, used as the fallback. */
export class GroqProvider implements AIProvider {
  readonly name = 'groq';
  private readonly client: AxiosInstance;

  constructor(private readonly apiKey: string, private readonly model: string) {
    this.client = axios.create({
      baseURL: 'https://api.groq.com/openai/v1',
      timeout: env.AI_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

  get isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async chat(messages: ChatMessage[], tools?: ToolDefinition[]): Promise<AIResponse> {
    if (!this.isConfigured) {
      throw new Error('Groq is not configured (missing GROQ_API_KEY)');
    }

    const payload: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: env.AI_TEMPERATURE,
      max_tokens: env.AI_MAX_TOKENS,
    };
    if (tools?.length) {
      payload.tools = tools;
      payload.tool_choice = 'auto';
    }

    try {
      const { data } = await this.client.post('/chat/completions', payload);
      const choice = data?.choices?.[0]?.message;
      if (!choice) throw new Error('Groq returned no message choice');

      const toolCalls: ToolCall[] = (choice.tool_calls ?? []).map((tc: any) => ({
        id: tc.id,
        name: tc.function?.name,
        arguments: safeJsonParse(tc.function?.arguments),
      }));

      return {
        content: choice.content ?? '',
        toolCalls,
        provider: this.name,
        model: this.model,
        raw: data,
      };
    } catch (err) {
      log.warn({ err: describeAxiosError(err) }, 'Groq request failed');
      throw err;
    }
  }
}

function safeJsonParse(input: unknown): Record<string, unknown> {
  if (typeof input !== 'string') return {};
  try {
    return JSON.parse(input);
  } catch {
    return {};
  }
}
