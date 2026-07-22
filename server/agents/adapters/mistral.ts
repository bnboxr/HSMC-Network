/**
 * Mistral adapter
 * OpenAI-compatible endpoint: https://api.mistral.ai/v1/chat/completions
 * Model: mistral-small-latest (~$0.20/1M tokens)
 * Requires: MISTRAL_API_KEY
 */

import type { AdapterConfig, AdapterResponse } from "./types";

const ENDPOINT = "https://api.mistral.ai/v1/chat/completions";
const DEFAULT_MODEL = "mistral-small-latest";

export async function streamMistral(config: AdapterConfig): Promise<AdapterResponse> {
  const apiKey = config.apiKey ?? Bun.env.MISTRAL_API_KEY;
  if (!apiKey) {
    return { error: "MISTRAL_API_KEY environment variable is required", status: 500 };
  }

  const model = config.model ?? DEFAULT_MODEL;

  const upstream = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: config.messages,
      stream: true,
    }),
  });

  if (!upstream.ok) {
    const text = await upstream.text();
    if (upstream.status === 429) {
      return { error: "Mistral rate limit reached. Try again soon.", status: 429 };
    }
    if (upstream.status === 401) {
      return { error: "Invalid Mistral API key.", status: 401 };
    }
    return { error: `Mistral error ${upstream.status}: ${text.slice(0, 200)}`, status: 502 };
  }

  return { body: upstream.body, status: 200 };
}
