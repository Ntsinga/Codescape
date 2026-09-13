import OpenAI from "openai";

/**
 * Provider-agnostic text/JSON generation. Supports OpenAI and Google Gemini.
 * Selection: AI_PROVIDER env ("openai" | "gemini") picks the preferred one;
 * otherwise whichever key is present. The other provider (if its key exists) is
 * used as an automatic fallback — so an OpenAI 429 transparently retries on Gemini.
 */
export type ProviderName = "openai" | "gemini";

export interface GenerateOptions {
  prompt: string;
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
}

let openaiClient: OpenAI | null = null;

const openaiKey = () => process.env.OPENAI_API_KEY;
const geminiKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

export function availableProviders(): ProviderName[] {
  const list: ProviderName[] = [];
  if (openaiKey()) list.push("openai");
  if (geminiKey()) list.push("gemini");
  return list;
}

/** Ordered list to try: explicit AI_PROVIDER first (if keyed), then the rest as fallback. */
export function preferredOrder(): ProviderName[] {
  const avail = availableProviders();
  const explicit = (process.env.AI_PROVIDER || "").toLowerCase();
  if ((explicit === "openai" || explicit === "gemini") && avail.includes(explicit as ProviderName)) {
    return [explicit as ProviderName, ...avail.filter((p) => p !== explicit)];
  }
  return avail;
}

async function callOpenAI(o: GenerateOptions): Promise<string> {
  const key = openaiKey();
  if (!key) throw new Error("OPENAI_API_KEY not set");
  if (!openaiClient) openaiClient = new OpenAI({ apiKey: key });
  const completion = await openaiClient.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
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
  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
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

export async function generate(o: GenerateOptions): Promise<{ text: string; provider: ProviderName }> {
  const order = preferredOrder();
  if (order.length === 0) {
    throw new Error("No AI provider configured. Set OPENAI_API_KEY or GEMINI_API_KEY in backend/.env.");
  }
  let lastErr: unknown;
  for (const provider of order) {
    try {
      const text = provider === "openai" ? await callOpenAI(o) : await callGemini(o);
      return { text, provider };
    } catch (err) {
      lastErr = err; // fall through to the next provider
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("All configured AI providers failed");
}
