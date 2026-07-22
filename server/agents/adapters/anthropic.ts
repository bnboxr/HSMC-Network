/**
 * Anthropic adapter
 * Endpoint: https://api.anthropic.com/v1/messages
 * Model: claude-3-haiku-20240307 (~$0.25/1M tokens)
 * Requires: ANTHROPIC_API_KEY
 *
 * NOTE: Anthropic uses a DIFFERENT message format than OpenAI.
 * We convert OpenAI-style {role,content} to Anthropic's native format.
 * Streaming uses Server-Sent Events with a different structure,
 * so we transform Anthropic SSE into OpenAI-compatible SSE chunks.
 */

import type { AdapterConfig, AdapterResponse } from "./types";

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-3-haiku-20240307";
const ANTHROPIC_VERSION = "2023-06-01";

export async function streamAnthropic(config: AdapterConfig): Promise<AdapterResponse> {
  const apiKey = config.apiKey ?? Bun.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { error: "ANTHROPIC_API_KEY environment variable is required", status: 500 };
  }

  const model = config.model ?? DEFAULT_MODEL;

  // Convert OpenAI-format messages to Anthropic format
  const systemMessages: string[] = [];
  const conversationMessages: Array<{ role: "user" | "assistant"; content: string }> = [];

  for (const msg of config.messages) {
    if (msg.role === "system") {
      systemMessages.push(msg.content);
    } else if (msg.role === "user") {
      conversationMessages.push({ role: "user", content: msg.content });
    } else if (msg.role === "assistant") {
      conversationMessages.push({ role: "assistant", content: msg.content });
    }
  }

  const body: Record<string, unknown> = {
    model,
    messages: conversationMessages,
    max_tokens: 4096,
    stream: true,
  };

  // Anthropic uses a top-level "system" param, not a message role
  if (systemMessages.length > 0) {
    body.system = systemMessages.join("\n\n");
  }

  const upstream = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!upstream.ok) {
    const text = await upstream.text();
    if (upstream.status === 429) {
      return { error: "Anthropic rate limit reached. Try again soon.", status: 429 };
    }
    if (upstream.status === 401) {
      return { error: "Invalid Anthropic API key.", status: 401 };
    }
    return { error: `Anthropic error ${upstream.status}: ${text.slice(0, 200)}`, status: 502 };
  }

  // Transform Anthropic SSE into OpenAI-compatible SSE
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
            // Send [DONE] signal
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
            return;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;

            const dataStr = trimmed.slice(6);
            if (dataStr === "[DONE]") {
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              continue;
            }

            try {
              const parsed = JSON.parse(dataStr);

              // Anthropic SSE format: { type: "content_block_delta", delta: { type: "text_delta", text: "..." } }
              // Convert to OpenAI format: { choices: [{ delta: { content: "..." } }] }
              let content = "";
              if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta") {
                content = parsed.delta.text ?? "";
              } else if (parsed.type === "content_block_start" && parsed.content_block?.type === "text") {
                content = parsed.content_block.text ?? "";
              } else if (parsed.type === "message_delta" && parsed.delta?.stop_reason) {
                // Stream end marker, just send [DONE]
                continue;
              }

              if (content) {
                const openAiChunk = JSON.stringify({
                  choices: [{ delta: { content } }],
                });
                controller.enqueue(encoder.encode(`data: ${openAiChunk}\n\n`));
              } else if (parsed.type === "message_stop") {
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
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
