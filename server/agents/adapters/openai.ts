/**
 * OpenAI adapter
 * Endpoint: https://api.openai.com/v1/chat/completions
 * Model: gpt-4o-mini (~$0.15/1M tokens)
 * Requires: OPENAI_API_KEY
 */

import type { AdapterConfig, AdapterResponse } from "./types";

const ENDPOINT = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";

export async function streamOpenAI(config: AdapterConfig): Promise<AdapterResponse> {
  const apiKey = config.apiKey ?? Bun.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { error: "OPENAI_API_KEY environment variable is required", status: 500 };
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
      return { error: "OpenAI rate limit reached. Try again soon.", status: 429 };
    }
    if (upstream.status === 401) {
      return { error: "Invalid OpenAI API key.", status: 401 };
    }
    return { error: `OpenAI error ${upstream.status}: ${text.slice(0, 200)}`, status: 502 };
  }

  return { body: upstream.body, status: 200 };
}
