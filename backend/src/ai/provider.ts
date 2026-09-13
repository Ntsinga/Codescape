import OpenAI from "openai";
import { getSetting, setSetting } from "../graph/queries.js";

/**
 * Provider-agnostic text/JSON generation across OpenAI and Google Gemini.
 * The active provider + model are chosen at runtime (persisted in settings, and
 * changeable from the UI), falling back to env defaults. If the selected provider
 * fails (e.g. a 503/429), generation automatically retries on the other provider.
 */
export type ProviderName = "openai" | "gemini";

export interface GenerateOptions {
  prompt: string;
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
}

const DEFAULT_MODELS: Record<ProviderName, string> = {
  openai: "gpt-4o-mini",
  gemini: "gemini-2.5-flash",
};

// Used only when the live model list can't be fetched.
const FALLBACK_MODELS: Record<ProviderName, string[]> = {
  openai: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1", "o4-mini"],
  gemini: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite", "gemini-2.0-flash", "gemini-flash-latest"],
};

let openaiClient: OpenAI | null = null;
const openaiKey = () => process.env.OPENAI_API_KEY;
const geminiKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

export function availableProviders(): ProviderName[] {
  const list: ProviderName[] = [];
  if (openaiKey()) list.push("openai");
  if (geminiKey()) list.push("gemini");
  return list;
}

/** The user-selected provider+model (settings), else env, else defaults. */
export function getSelection(): { provider: ProviderName; model: string } {
  const avail = availableProviders();
  const savedProvider = getSetting("ai_provider") as ProviderName | null;
  const envProvider = (process.env.AI_PROVIDER || "").toLowerCase() as ProviderName | "";
  let provider: ProviderName =
    (savedProvider && avail.includes(savedProvider) && savedProvider) ||
    (envProvider && avail.includes(envProvider as ProviderName) && (envProvider as ProviderName)) ||
    avail[0] ||
    "openai";

  const savedModel = getSetting(`ai_model_${provider}`);
  const envModel = provider === "openai" ? process.env.OPENAI_MODEL : process.env.GEMINI_MODEL;
  const model = savedModel || envModel || DEFAULT_MODELS[provider];
  return { provider, model };
}

export function setSelection(provider: ProviderName, model: string): void {
  setSetting("ai_provider", provider);
  if (model) setSetting(`ai_model_${provider}`, model);
}

function modelFor(provider: ProviderName): string {
  const sel = getSelection();
  if (sel.provider === provider) return sel.model;
  return (provider === "openai" ? process.env.OPENAI_MODEL : process.env.GEMINI_MODEL) || DEFAULT_MODELS[provider];
}

/** Order to try: selected provider first, then the other as fallback. */
function providerOrder(): ProviderName[] {
  const avail = availableProviders();
  const sel = getSelection().provider;
  return [sel, ...avail.filter((p) => p !== sel)].filter((p) => avail.includes(p));
}

async function callOpenAI(o: GenerateOptions): Promise<string> {
  const key = openaiKey();
  if (!key) throw new Error("OPENAI_API_KEY not set");
  if (!openaiClient) openaiClient = new OpenAI({ apiKey: key });
  const completion = await openaiClient.chat.completions.create({
    model: modelFor("openai"),
    messages: [{ role: "user", content: o.prompt }],
    temperature: o.temperature ?? 0.2,
    max_tokens: o.maxTokens ?? 1000,
    ...(o.json ? { response_format: { type: "json_object" as const } } : {}),
  });
  return completion.choices[0]?.message?.content ?? "";
}

async function callGemini(o: GenerateOptions): Promise<string> {
  const key = geminiKey();
  if (!key) throw new Error("GEMINI_API_KEY not set");
  const model = modelFor("gemini");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    contents: [{ parts: [{ text: o.prompt }] }],
    generationConfig: {
      temperature: o.temperature ?? 0.2,
      maxOutputTokens: o.maxTokens ?? 1000,
      ...(o.json ? { responseMimeType: "application/json" } : {}),
    },
  };
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gemini API error ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as any;
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p: any) => p.text ?? "").join("");
}

export async function generate(o: GenerateOptions): Promise<{ text: string; provider: ProviderName; model: string }> {
  const order = providerOrder();
  if (order.length === 0) {
    throw new Error("No AI provider configured. Set OPENAI_API_KEY or GEMINI_API_KEY in backend/.env.");
  }
  let lastErr: unknown;
  for (const provider of order) {
    try {
      const text = provider === "openai" ? await callOpenAI(o) : await callGemini(o);
      return { text, provider, model: modelFor(provider) };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("All configured AI providers failed");
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

export async function listModels(): Promise<{ openai: string[]; gemini: string[] }> {
  const [openai, gemini] = await Promise.all([listOpenAIModels(), listGeminiModels()]);
  return { openai, gemini };
}
