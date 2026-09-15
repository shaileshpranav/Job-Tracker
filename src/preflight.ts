/**
 * Fail fast, before a task is queued, when its model can't possibly answer:
 * Ollama not running or the model not pulled, or a hosted provider with no key.
 * Better than a task that sits in the queue and dies a minute later.
 */
import { apiKey, llmSettings, taskRoute, TASKS, type Task } from "./settings.ts";
import { HttpError } from "./http.ts";

type Probe = { at: number; models: Set<string> | null; error?: string };
const probes = new Map<string, Probe>();

/** Ollama's model list, cached for a few seconds so a burst of tasks makes one request. */
async function ollamaModels(host: string): Promise<Probe> {
  const hit = probes.get(host);
  if (hit && Date.now() - hit.at < 8_000) return hit;
  let probe: Probe;
  try {
    const res = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(2_500) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { models?: { name: string }[] };
    probe = { at: Date.now(), models: new Set((data.models ?? []).map((m) => m.name)) };
  } catch (e: any) {
    probe = { at: Date.now(), models: null, error: e.name === "TimeoutError" ? "no answer in 2.5s" : e.cause?.code ?? e.message };
  }
  probes.set(host, probe);
  return probe;
}

const PROVIDER_LABEL = { anthropic: "Anthropic", openrouter: "OpenRouter", ollama: "Ollama" } as const;

export async function preflight(...tasks: Task[]) {
  const checked = new Set<string>();
  for (const task of tasks) {
    const r = taskRoute(task);
    const id = `${r.provider}:${r.model}`;
    if (checked.has(id)) continue;
    checked.add(id);
    const uses = `“${TASKS[task]}” runs on ${PROVIDER_LABEL[r.provider]} · ${r.model}`;
    if (r.provider === "ollama") {
      const host = llmSettings().ollamaHost;
      const { models, error } = await ollamaModels(host);
      if (!models) throw new HttpError(503, `${uses}, but Ollama isn't reachable at ${host} (${error}). Start it with \`ollama serve\`, then try again.`);
      if (!models.has(r.model) && !models.has(`${r.model}:latest`)) throw new HttpError(400, `${uses}, but that model isn't pulled — run \`ollama pull ${r.model}\`, or pick one that is in Settings → Per-task models.`);
    } else if (!apiKey(r.provider)) {
      throw new HttpError(400, `${uses}, but there's no ${PROVIDER_LABEL[r.provider]} API key — add one in Settings → Model.`);
    }
  }
}
