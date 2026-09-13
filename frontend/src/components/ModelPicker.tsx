import { useEffect, useState } from "react";
import { getAiModels, selectAiModel, type AiModels } from "../api/client";

/** Dropdown to switch the active AI provider + model (fetched live from each provider). */
export function ModelPicker() {
  const [data, setData] = useState<AiModels | null>(null);
  const [value, setValue] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getAiModels()
      .then((d) => {
        setData(d);
        setValue(`${d.current.provider}::${d.current.model}`);
      })
      .catch(() => setData(null));
  }, []);

  if (!data || data.providers.length === 0) return null;

  async function onChange(next: string) {
    setValue(next);
    const [provider, model] = next.split("::");
    setSaving(true);
    try {
      await selectAiModel(provider as "openai" | "gemini", model);
    } finally {
      setSaving(false);
    }
  }

  // Ensure the current selection is always an option even if the live list missed it.
  const ensure = (provider: "openai" | "gemini", list: string[]) => {
    if (data.current.provider === provider && data.current.model && !list.includes(data.current.model)) {
      return [data.current.model, ...list];
    }
    return list;
  };

  return (
    <select className="model-picker" value={value} onChange={(e) => onChange(e.target.value)} disabled={saving} title="AI model used for naming & explanations">
      {data.providers.includes("openai") && data.models.openai.length > 0 && (
        <optgroup label="OpenAI">
          {ensure("openai", data.models.openai).map((m) => (
            <option key={`openai::${m}`} value={`openai::${m}`}>{m}</option>
          ))}
        </optgroup>
      )}
      {data.providers.includes("gemini") && data.models.gemini.length > 0 && (
        <optgroup label="Gemini">
          {ensure("gemini", data.models.gemini).map((m) => (
            <option key={`gemini::${m}`} value={`gemini::${m}`}>{m}</option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
