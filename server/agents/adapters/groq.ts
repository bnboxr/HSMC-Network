/**
 * Groq adapter
 * OpenAI-compatible endpoint: https://api.groq.com/openai/v1/chat/completions
 * Model: llama-3.1-70b-versatile (free tier, rate-limited)
 * Requires: GROQ_API_KEY
 */

import type { AdapterConfig, AdapterResponse } from "./types";

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "llama-3.1-70b-versatile";

export async function streamGroq(config: AdapterConfig): Promise<AdapterResponse> {
  const apiKey = config.apiKey ?? Bun.env.GROQ_API_KEY;
  if (!apiKey) {
    return { error: "GROQ_API_KEY environment variable is required", status: 500 };
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
      return { error: "Groq rate limit reached. Free tier has limits — try again.", status: 429 };
    }
    if (upstream.status === 401) {
      return { error: "Invalid Groq API key.", status: 401 };
    }
    return { error: `Groq error ${upstream.status}: ${text.slice(0, 200)}`, status: 502 };
  }

  return { body: upstream.body, status: 200 };
}
