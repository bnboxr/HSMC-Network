/**
 * Shared types for AI provider adapters.
 * All adapters accept AdapterConfig and return AdapterResponse.
 */

export interface AdapterConfig {
  /** OpenAI-format messages array: [{role, content}, ...] */
  messages: Array<{ role: string; content: string }>;
  /** Override default model for this provider */
  model?: string;
  /** Override API key (falls back to env var) */
  apiKey?: string;
}

export interface AdapterResponse {
  /** ReadableStream of SSE data (OpenAI-compatible format), or null on error */
  body: ReadableStream<Uint8Array> | null;
  /** HTTP status code */
  status: number;
  /** Error message if status >= 400 */
  error?: string;
}

/** Union type of all supported AI providers */
export type AIProvider = "hsmc-ai" | "openai" | "anthropic" | "groq" | "mistral" | "ollama";

/** List of all providers for validation */
export const ALL_PROVIDERS: AIProvider[] = [
  "hsmc-ai",
  "openai",
  "anthropic",
  "groq",
  "mistral",
  "ollama",
];

/** Human-readable labels for providers */
export const PROVIDER_LABELS: Record<AIProvider, string> = {
  hsmc-ai: "HSMC-AI (Gemini Flash)",
  openai: "OpenAI (GPT-4o Mini)",
  anthropic: "Anthropic (Claude 3 Haiku)",
  groq: "Groq (Llama 3.1 70B)",
  mistral: "Mistral (Mistral Small)",
  ollama: "Ollama (Llama 3.2 3B, local)",
};

/** Which env var each provider needs */
export const PROVIDER_ENV_VARS: Record<AIProvider, string | null> = {
  hsmc-ai: "HSMC_AI_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  groq: "GROQ_API_KEY",
  mistral: "MISTRAL_API_KEY",
  ollama: null, // no API key needed
};
