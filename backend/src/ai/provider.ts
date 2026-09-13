import OpenAI from "openai";
import { getSetting, setSetting } from "../graph/queries.js";

/**
 * Provider-agnostic text/JSON generation across OpenAI and Google Gemini.
 * The active provider + model are chosen at runtime (persisted in settings, and
 * changeable from the UI), falling back to env defaults. If the selected provider
 * fails (e.g. a 503/429), generation automatically retries on the other provider.
 */
export type ProviderName = "openai" | "gemini" | "deepseek";

export interface GenerateOptions {
  prompt: string;
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
  /** Optional JSON schema (Gemini responseSchema / OpenAI json_schema) to force output shape. */
  schema?: Record<string, unknown>;
  schemaName?: string;
}

const DEFAULT_MODELS: Record<ProviderName, string> = {
  openai: "gpt-4o-mini",
  gemini: "gemini-3.6-flash",
  deepseek: "deepseek-chat",
};

// Used only when the live model list can't be fetched.
const FALLBACK_MODELS: Record<ProviderName, string[]> = {
  openai: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1", "o4-mini"],
  gemini: ["gemini-3.6-flash", "gemini-flash-latest", "gemini-2.5-flash", "gemini-2.5-pro"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
};

const ENV_MODEL: Record<ProviderName, string | undefined> = {
  get openai() { return process.env.OPENAI_MODEL; },
  get gemini() { return process.env.GEMINI_MODEL; },
  get deepseek() { return process.env.DEEPSEEK_MODEL; },
};

let openaiClient: OpenAI | null = null;
let deepseekClient: OpenAI | null = null;
const openaiKey = () => process.env.OPENAI_API_KEY;
const geminiKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const deepseekKey = () => process.env.DEEPSEEK_API_KEY;

export function availableProviders(): ProviderName[] {
  const list: ProviderName[] = [];
  if (openaiKey()) list.push("openai");
  if (geminiKey()) list.push("gemini");
  if (deepseekKey()) list.push("deepseek");
  return list;
}

/** The user-selected provider+model (settings), else env, else defaults. */
export async function getSelection(): Promise<{ provider: ProviderName; model: string }> {
  const avail = availableProviders();
  const savedProvider = (await getSetting("ai_provider")) as ProviderName | null;
  const envProvider = (process.env.AI_PROVIDER || "").toLowerCase() as ProviderName | "";
  let provider: ProviderName =
    (savedProvider && avail.includes(savedProvider) && savedProvider) ||
    (envProvider && avail.includes(envProvider as ProviderName) && (envProvider as ProviderName)) ||
    avail[0] ||
    "openai";

  const savedModel = await getSetting(`ai_model_${provider}`);
  const model = savedModel || ENV_MODEL[provider] || DEFAULT_MODELS[provider];
  return { provider, model };
}

export async function setSelection(provider: ProviderName, model: string): Promise<void> {
  await setSetting("ai_provider", provider);
  if (model) await setSetting(`ai_model_${provider}`, model);
}

async function modelFor(provider: ProviderName): Promise<string> {
  const sel = await getSelection();
  if (sel.provider === provider) return sel.model;
  return (await getSetting(`ai_model_${provider}`)) || ENV_MODEL[provider] || DEFAULT_MODELS[provider];
}

/** Order to try: selected provider first, then the other as fallback. */
async function providerOrder(): Promise<ProviderName[]> {
  const avail = availableProviders();
  const sel = (await getSelection()).provider;
  return [sel, ...avail.filter((p) => p !== sel)].filter((p) => avail.includes(p));
}

async function callOpenAI(o: GenerateOptions): Promise<string> {
  const key = openaiKey();
  if (!key) throw new Error("OPENAI_API_KEY not set");
  if (!openaiClient) openaiClient = new OpenAI({ apiKey: key });
  const responseFormat = o.schema
    ? { type: "json_schema" as const, json_schema: { name: o.schemaName ?? "response", schema: o.schema, strict: false } }
    : o.json
    ? { type: "json_object" as const }
    : undefined;
  const completion = await openaiClient.chat.completions.create({
    model: await modelFor("openai"),
    messages: [{ role: "user", content: o.prompt }],
    temperature: o.temperature ?? 0.2,
    max_tokens: o.maxTokens ?? 1000,
    ...(responseFormat ? { response_format: responseFormat } : {}),
  });
  return completion.choices[0]?.message?.content ?? "";
}

async function callDeepSeek(o: GenerateOptions): Promise<string> {
  const key = deepseekKey();
  if (!key) throw new Error("DEEPSEEK_API_KEY not set");
  if (!deepseekClient) deepseekClient = new OpenAI({ apiKey: key, baseURL: "https://api.deepseek.com" });
  // DeepSeek is OpenAI-compatible but supports only json_object (no json_schema).
  const completion = await deepseekClient.chat.completions.create({
    model: await modelFor("deepseek"),
    messages: [{ role: "user", content: o.prompt }],
    temperature: o.temperature ?? 0.2,
    max_tokens: o.maxTokens ?? 1000,
    ...(o.json || o.schema ? { response_format: { type: "json_object" as const } } : {}),
  });
  return completion.choices[0]?.message?.content ?? "";
}

async function callGemini(o: GenerateOptions): Promise<string> {
  const key = geminiKey();
  if (!key) throw new Error("GEMINI_API_KEY not set");
  const model = await modelFor("gemini");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const wantJson = o.json || Boolean(o.schema);
  const baseConfig: Record<string, unknown> = {
    temperature: o.temperature ?? 0.2,
    maxOutputTokens: o.maxTokens ?? 1000,
    ...(wantJson ? { responseMimeType: "application/json" } : {}),
    ...(o.schema ? { responseSchema: o.schema } : {}),
  };

  async function call(withThinkingDisabled: boolean) {
    // Gemini 2.5/3.x flash models spend output tokens on internal "thinking",
    // which can consume the whole budget and truncate the answer to "{". Disable it
    // so the token budget goes to the actual JSON.
    const generationConfig = withThinkingDisabled ? { ...baseConfig, thinkingConfig: { thinkingBudget: 0 } } : baseConfig;
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: o.prompt }] }], generationConfig }),
    });
  }

  let res = await call(true);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    // A model that rejects thinkingConfig (400) → retry once without it.
    if (res.status === 400 && /thinking/i.test(detail)) {
      res = await call(false);
      if (!res.ok) {
        const d2 = await res.text().catch(() => "");
        throw new Error(`Gemini API error ${res.status}: ${d2.slice(0, 200)}`);
      }
    } else {
      throw new Error(`Gemini API error ${res.status}: ${detail.slice(0, 200)}`);
    }
  }
  const data = (await res.json()) as any;
  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const text = parts.map((p: any) => p.text ?? "").join("");
  // Surface truncation/blocking so it isn't silently parsed as empty.
  if (!text && candidate?.finishReason && candidate.finishReason !== "STOP") {
    throw new Error(`Gemini returned no text (finishReason=${candidate.finishReason})`);
  }
  return text;
}

export async function generate(o: GenerateOptions): Promise<{ text: string; provider: ProviderName; model: string }> {
  const order = await providerOrder();
  if (order.length === 0) {
    throw new Error("No AI provider configured. Set OPENAI_API_KEY or GEMINI_API_KEY in backend/.env.");
  }
  const errors: string[] = [];
  for (const provider of order) {
    try {
      const text = provider === "openai" ? await callOpenAI(o) : provider === "deepseek" ? await callDeepSeek(o) : await callGemini(o);
      return { text, provider, model: await modelFor(provider) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const model = await modelFor(provider);
      console.warn(`[ai] ${provider}/${model} failed: ${msg}`);
      errors.push(`${provider} (${model}): ${msg}`);
    }
  }
  // Surface the selected provider's failure first — it's the one the user chose.
  throw new Error(errors.join(" | "));
}

// ---- Live model listing --------------------------------------------------

const OPENAI_CHAT_RE = /^(gpt-|o1|o3|o4|chatgpt)/i;
const OPENAI_EXCLUDE_RE = /(embedding|whisper|tts|audio|realtime|image|dall-e|moderation|transcribe|search|instruct)/i;

async function listOpenAIModels(): Promise<string[]> {
  const key = openaiKey();
  if (!key) return [];
  try {
    const res = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) return FALLBACK_MODELS.openai;
    const data = (await res.json()) as any;
    const ids: string[] = (data?.data ?? []).map((m: any) => m.id).filter((id: string) => OPENAI_CHAT_RE.test(id) && !OPENAI_EXCLUDE_RE.test(id));
    return ids.length ? ids.sort() : FALLBACK_MODELS.openai;
  } catch {
    return FALLBACK_MODELS.openai;
  }
}

async function listGeminiModels(): Promise<string[]> {
  const key = geminiKey();
  if (!key) return [];
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}&pageSize=200`);
    if (!res.ok) return FALLBACK_MODELS.gemini;
    const data = (await res.json()) as any;
    const ids: string[] = (data?.models ?? [])
      .filter((m: any) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"))
      .map((m: any) => String(m.name).replace(/^models\//, ""))
      .filter((id: string) => !/embedding|aqa|image|vision|tts|computer-use|deep-research|antigravity|robotics|live|audio/i.test(id));
    return ids.length ? ids.sort() : FALLBACK_MODELS.gemini;
  } catch {
    return FALLBACK_MODELS.gemini;
  }
}

async function listDeepSeekModels(): Promise<string[]> {
  const key = deepseekKey();
  if (!key) return [];
  try {
    const res = await fetch("https://api.deepseek.com/models", { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) return FALLBACK_MODELS.deepseek;
    const data = (await res.json()) as any;
    const ids: string[] = (data?.data ?? []).map((m: any) => m.id).filter(Boolean);
    return ids.length ? ids.sort() : FALLBACK_MODELS.deepseek;
  } catch {
    return FALLBACK_MODELS.deepseek;
  }
}

export async function listModels(): Promise<{ openai: string[]; gemini: string[]; deepseek: string[] }> {
  const [openai, gemini, deepseek] = await Promise.all([listOpenAIModels(), listGeminiModels(), listDeepSeekModels()]);
  return { openai, gemini, deepseek };
}
