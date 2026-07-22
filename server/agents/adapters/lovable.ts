/**
 * Lovable AI Gateway adapter
 * OpenAI-compatible endpoint: https://ai.gateway.lovable.dev/v1/chat/completions
 * Model: google/gemini-3-flash-preview (free)
 * Requires: LOVABLE_API_KEY
 */

import type { AdapterConfig, AdapterResponse } from "./types";

const ENDPOINT = "https://ai.gateway.lovable.dev/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-3-flash-preview";

export async function streamLovable(config: AdapterConfig): Promise<AdapterResponse> {
  const apiKey = config.apiKey ?? Bun.env.LOVABLE_API_KEY;
  if (!apiKey) {
    return { error: "LOVABLE_API_KEY environment variable is required", status: 500 };
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
      return { error: "Rate limit reached. Try again in a few seconds.", status: 429 };
    }
    if (upstream.status === 402) {
      return { error: "AI credits exhausted. Top up to continue.", status: 402 };
    }
    return { error: `Upstream error ${upstream.status}: ${text.slice(0, 200)}`, status: 502 };
  }

  return { body: upstream.body, status: 200 };
}
