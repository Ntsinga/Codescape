import { useEffect, useState } from "react";
import { getAiModels, selectAiModel, type AiModels, type ProviderName } from "../api/client";

const PROVIDER_LABEL: Record<ProviderName, string> = {
  openai: "OpenAI",
  gemini: "Gemini",
  deepseek: "DeepSeek",
};

/** Two dropdowns: provider, then that provider's models (fetched live). */
export function ModelPicker() {
  const [data, setData] = useState<AiModels | null>(null);
  const [provider, setProvider] = useState<ProviderName | "">("");
  const [model, setModel] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getAiModels()
      .then((d) => {
        setData(d);
        setProvider(d.current.provider);
        setModel(d.current.model);
      })
      .catch(() => setData(null));
  }, []);

  if (!data || data.providers.length === 0) return null;

  const modelsForProvider = (p: ProviderName): string[] => {
    const list = data.models[p] ?? [];
    // Keep the current model visible even if the live list missed it.
    if (data.current.provider === p && data.current.model && !list.includes(data.current.model)) return [data.current.model, ...list];
    return list;
  };

  async function onProvider(next: ProviderName) {
    setProvider(next);
    const first = modelsForProvider(next)[0] ?? "";
    setModel(first);
    if (first) await save(next, first);
  }
  async function onModel(next: string) {
    setModel(next);
    if (provider) await save(provider, next);
  }
  async function save(p: ProviderName, m: string) {
    setSaving(true);
    try { await selectAiModel(p, m); } finally { setSaving(false); }
  }

  return (
    <div className="model-picker-group" title="AI provider & model for naming/explanations">
      <select className="model-picker provider" value={provider} onChange={(e) => onProvider(e.target.value as ProviderName)} disabled={saving}>
        {data.providers.map((p) => (
          <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>
        ))}
      </select>
      <select className="model-picker model" value={model} onChange={(e) => onModel(e.target.value)} disabled={saving || !provider}>
        {provider && modelsForProvider(provider).map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
    </div>
  );
}
