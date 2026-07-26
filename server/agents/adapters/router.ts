/**
 * AI Provider Router
 *
 * Routes streaming requests to the appropriate adapter based on provider name.
 * All adapters accept OpenAI-format messages and return OpenAI-compatible SSE streams.
 *
 * Usage:
 *   import { streamToAI, resolveProvider } from "./agents/adapters/router";
 *   const response = await streamToAI("ollama", messages);
 */

import type { AIProvider, AdapterResponse } from "./types";
import { ALL_PROVIDERS } from "./types";
import { streamHsmcAi } from "./hsmc-ai";
import { streamOpenAI } from "./openai";
import { streamAnthropic } from "./anthropic";
import { streamGroq } from "./groq";
import { streamMistral } from "./mistral";
import { streamOllama } from "./ollama";

/**
 * Route a streaming AI request to the correct provider adapter.
 *
 * @param provider - Which AI provider to use
 * @param messages - OpenAI-format messages array [{role, content}, ...]
 * @param model - Optional model override (e.g., "gpt-4o" instead of default "gpt-4o-mini")
 * @param apiKey - Optional API key override (falls back to provider's env var)
 * @returns AdapterResponse with {body, status, error?}
 */
export async function streamToAI(
  provider: AIProvider,
  messages: Array<{ role: string; content: string }>,
  model?: string,
  apiKey?: string
): Promise<AdapterResponse> {
  const config = { messages, model, apiKey };

  switch (provider) {
    case "hsmc-ai":
      return streamHsmcAi(config);
    case "openai":
      return streamOpenAI(config);
    case "anthropic":
      return streamAnthropic(config);
    case "groq":
      return streamGroq(config);
    case "mistral":
      return streamMistral(config);
    case "ollama":
      return streamOllama(config);
    default: {
      // Exhaustiveness check
      const _exhaustive: never = provider;
      return { error: `Unknown provider: ${provider}`, status: 400, body: null };
    }
  }
}

/**
 * Resolve which provider to use, respecting:
 * 1. Explicit per-request override (from body.provider)
 * 2. Global env var AI_PROVIDER
 * 3. Fallback to "hsmc-ai" (original default)
 */
export function resolveProvider(requestedProvider?: string): AIProvider {
  if (requestedProvider) {
    const normalized = requestedProvider.toLowerCase().trim();
    if (ALL_PROVIDERS.includes(normalized as AIProvider)) {
      return normalized as AIProvider;
    }
  }

  const envProvider = Bun.env.AI_PROVIDER?.toLowerCase().trim();
  if (envProvider && ALL_PROVIDERS.includes(envProvider as AIProvider)) {
    return envProvider as AIProvider;
  }

  return "hsmc-ai"; // original default
}
