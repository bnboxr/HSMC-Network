/**
 * Ollama adapter (LOCAL)
 * Endpoint: http://localhost:11434/api/chat
 * Model default: llama3.2:3b (fits 4GB RAM)
 * Fallback: gemma2:2b (even lighter)
 * Cost: FREE, zero internet required
 * Requires: Ollama running locally (no API key needed)
 *
 * NOTE: Ollama uses its own native chat format, different from OpenAI.
 * We convert OpenAI-style messages and transform Ollama SSE into OpenAI-compatible SSE.
 */

import type { AdapterConfig, AdapterResponse } from "./types";

const ENDPOINT = "http://localhost:11434/api/chat";
const DEFAULT_MODEL = "llama3.2:3b";
const FALLBACK_MODEL = "gemma2:2b";

export async function streamOllama(config: AdapterConfig): Promise<AdapterResponse> {
  const model = config.model ?? DEFAULT_MODEL;

  // Convert OpenAI-format messages to Ollama native format
  const ollamaMessages: Array<{ role: string; content: string }> = [];

  for (const msg of config.messages) {
    if (msg.role === "system") {
      ollamaMessages.push({ role: "system", content: msg.content });
    } else if (msg.role === "user") {
      ollamaMessages.push({ role: "user", content: msg.content });
    } else if (msg.role === "assistant") {
      ollamaMessages.push({ role: "assistant", content: msg.content });
    }
  }

  async function tryFetch(modelName: string): Promise<Response> {
    return fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelName,
        messages: ollamaMessages,
        stream: true,
      }),
    });
  }

  let upstream = await tryFetch(model);

  // If primary model fails (e.g., not pulled), try fallback
  if (!upstream.ok && model === DEFAULT_MODEL) {
    const fallback = await tryFetch(FALLBACK_MODEL);
    if (fallback.ok) {
      upstream = fallback;
    }
  }

  if (!upstream.ok) {
    const text = await upstream.text();
    if (upstream.status === 404 || text.includes("not found")) {
      return {
        error:
          `Ollama model not found. Run: ollama pull ${model} (or ${FALLBACK_MODEL}). Make sure Ollama is running on localhost:11434.`,
        status: 502,
      };
    }
    return { error: `Ollama error ${upstream.status}: ${text.slice(0, 200)}`, status: 502 };
  }

  // Transform Ollama SSE into OpenAI-compatible SSE
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  const transformedStream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
            return;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            try {
              const parsed = JSON.parse(trimmed);

              // Ollama format: { message: { role: "assistant", content: "..." }, done: false }
              // Convert to OpenAI format: { choices: [{ delta: { content: "..." } }] }
              if (parsed.done) {
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              } else if (parsed.message?.content) {
                const openAiChunk = JSON.stringify({
                  choices: [{ delta: { content: parsed.message.content } }],
                });
                controller.enqueue(encoder.encode(`data: ${openAiChunk}\n\n`));
              }
            } catch {
              // Skip unparseable lines
            }
          }
        }
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return { body: transformedStream, status: 200 };
}
