/**
 * Provider abstraction. Anthropic goes through the official SDK (native PDF
 * input, structured outputs, web_fetch). OpenRouter and Ollama speak the
 * OpenAI-compatible chat-completions shape, called with plain fetch.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { PDFParse } from "pdf-parse";
import { llmSettings, taskRoute, apiKey, type Provider, type Task } from "./settings.ts";

export interface LLM {
  readonly provider: Provider;
  readonly model: string;
  /** Long-form text generation. */
  generate(system: string, user: string, maxTokens?: number): Promise<string>;
  /** Generation constrained to a Zod schema. */
  structured<T>(system: string, user: string, schema: z.ZodType<T>, maxTokens?: number): Promise<T>;
  /** Turn a PDF into Markdown following `instruction`. */
  pdfToMarkdown(pdf: Buffer, instruction: string): Promise<string>;
  /** Fetch a URL's text server-side, if the provider can. Returns null if unsupported. */
  fetchUrlText(url: string): Promise<string | null>;
}

const REQUEST_TIMEOUT_MS = 10 * 60 * 1000; // local models can be slow

// ---------------------------------------------------------------- Anthropic

function anthropicClient() {
  const key = apiKey("anthropic");
  // With no saved key the SDK still resolves ANTHROPIC_AUTH_TOKEN / an `ant auth login` profile.
  return key ? new Anthropic({ apiKey: key }) : new Anthropic();
}

class AnthropicLLM implements LLM {
  readonly provider = "anthropic" as const;
  private client = anthropicClient();
  // Server-side refusal fallback: if the model declines on policy grounds the
  // API re-runs the request on a fallback model inside the same call.
  private fallback = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };
  readonly model: string;
  constructor(model: string) { this.model = model; }

  private text(msg: Anthropic.Beta.BetaMessage | Anthropic.Message) {
    if (msg.stop_reason === "refusal") throw new Error(`Claude declined: ${msg.stop_details?.explanation ?? "no explanation"}`);
    return msg.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  }

  async generate(system: string, user: string, maxTokens = 16000) {
    const stream = this.client.beta.messages.stream({
      model: this.model, max_tokens: maxTokens,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
      ...this.fallback,
    });
    return this.text(await stream.finalMessage());
  }

  async structured<T>(system: string, user: string, schema: z.ZodType<T>, maxTokens = 16000) {
    const res = await this.client.messages.parse({
      model: this.model, max_tokens: maxTokens, system,
      messages: [{ role: "user", content: user }],
      output_config: { format: zodOutputFormat(schema) },
    });
    if (res.stop_reason === "refusal") throw new Error(`Claude declined: ${res.stop_details?.explanation ?? "no explanation"}`);
    if (!res.parsed_output) throw new Error("Model returned no structured output");
    return res.parsed_output as T;
  }

  async pdfToMarkdown(pdf: Buffer, instruction: string) {
    const stream = this.client.beta.messages.stream({
      model: this.model, max_tokens: 16000,
      messages: [{ role: "user", content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.toString("base64") } },
        { type: "text", text: instruction },
      ] }],
      ...this.fallback,
    });
    return this.text(await stream.finalMessage());
  }

  async fetchUrlText(url: string) {
    const msg = await this.client.messages.create({
      model: this.model, max_tokens: 16000,
      tools: [{ type: "web_fetch_20260209", name: "web_fetch", max_uses: 2 }],
      messages: [{ role: "user", content: `Fetch ${url} and return the complete text of the job posting (title, company, location, description, requirements, any application questions). Output the posting text only.` }],
    });
    return this.text(msg);
  }
}

// ------------------------------------------------- OpenAI-compatible (shared)

type ChatMessage = { role: "system" | "user"; content: string };

abstract class OpenAICompatLLM implements LLM {
  abstract readonly provider: Provider;
  readonly model: string;
  constructor(model: string) { this.model = model; }
  protected abstract endpoint(): string;
  protected abstract headers(): Record<string, string>;
  /** Provider-specific way to ask for schema-constrained JSON. */
  protected abstract jsonFormat(schema: object): object;

  protected async chat(messages: ChatMessage[], extra: object = {}, maxTokens = 16000): Promise<string> {
    const res = await fetch(this.endpoint(), {
      method: "POST",
      headers: { "content-type": "application/json", ...this.headers() },
      body: JSON.stringify({ model: this.model, messages, max_tokens: maxTokens, ...extra }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || body.error) {
      const msg = body.error?.message ?? body.error ?? res.statusText;
      throw new Error(`${this.provider} (${this.model}): ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
    }
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error(`${this.provider}: empty response`);
    return content.trim();
  }

  generate(system: string, user: string, maxTokens?: number) {
    return this.chat([{ role: "system", content: system }, { role: "user", content: user }], {}, maxTokens);
  }

  async structured<T>(system: string, user: string, schema: z.ZodType<T>, maxTokens?: number) {
    const jsonSchema = z.toJSONSchema(schema, { target: "draft-7" });
    const sys = `${system}\n\nRespond with a single JSON object matching this JSON Schema, and nothing else — no prose, no code fences:\n${JSON.stringify(jsonSchema)}`;
    const messages: ChatMessage[] = [{ role: "system", content: sys }, { role: "user", content: user }];
    // Try constrained decoding first; if the provider rejects it or the model
    // still returns broken JSON, retry once prompt-only (small local models
    // sometimes emit bad escapes even under a schema).
    let raw: string | null = null, firstError: Error | null = null;
    try {
      raw = await this.chat(messages, this.jsonFormat(jsonSchema), maxTokens);
      return parseJson(raw, schema);
    } catch (e: any) {
      firstError = e;
      if (raw === null && !/format|schema|json/i.test(e.message)) throw e;
    }
    const retry = await this.chat([...messages, { role: "user", content: "Your previous reply was not valid JSON. Reply again with only the JSON object, correctly escaped." }], {}, maxTokens);
    try { return parseJson(retry, schema); } catch { throw firstError; }
  }

  async pdfToMarkdown(pdf: Buffer, instruction: string) {
    const parser = new PDFParse({ data: pdf });
    try {
      const { text } = await parser.getText();
      if (text.trim().length < 50) throw new Error("PDF has no extractable text (scanned image?). Export it from Word/Pages as a text PDF or use a .docx.");
      return this.generate("You convert documents to Markdown.", `${instruction}\n\n<resume>\n${text}\n</resume>`);
    } finally {
      await parser.destroy();
    }
  }

  async fetchUrlText() { return null; }
}

function parseJson<T>(raw: string, schema: z.ZodType<T>): T {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const start = cleaned.indexOf("{"), end = cleaned.lastIndexOf("}");
  const text = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  let data: unknown;
  try { data = JSON.parse(text); }
  catch (e: any) {
    // Common small-model slips: trailing commas, single-quote escapes, literal newlines in strings.
    const repaired = text.replace(/,\s*([}\]])/g, "$1").replace(/\\'/g, "'").replace(/(?<=":\s*"[^"]*)\n(?=[^"]*")/g, " ");
    try { data = JSON.parse(repaired); }
    catch { throw new Error(`Model did not return valid JSON (${e.message}). Tail: …${text.slice(-160)}`); }
  }
  const result = schema.safeParse(data);
  if (!result.success) throw new Error(`Model JSON did not match schema: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return result.data;
}

// --------------------------------------------------------------- OpenRouter

class OpenRouterLLM extends OpenAICompatLLM {
  readonly provider = "openrouter" as const;
  protected endpoint() { return "https://openrouter.ai/api/v1/chat/completions"; }
  protected headers() {
    const key = apiKey("openrouter");
    if (!key) throw new Error("No OpenRouter API key. Add one in ⚙ Settings (or OPENROUTER_API_KEY in .env).");
    return { authorization: `Bearer ${key}`, "x-title": "Job Tracker" };
  }
  protected jsonFormat(schema: object) {
    return { response_format: { type: "json_schema", json_schema: { name: "result", strict: true, schema } } };
  }
}

// ------------------------------------------------------------------- Ollama

class OllamaLLM extends OpenAICompatLLM {
  readonly provider = "ollama" as const;
  private host: string;
  constructor(model: string, host: string) { super(model); this.host = host; }
  protected endpoint() { return `${this.host}/v1/chat/completions`; }
  protected headers() { return {}; }
  protected jsonFormat(schema: object) {
    return { response_format: { type: "json_schema", json_schema: { name: "result", schema } } };
  }
  protected override async chat(messages: ChatMessage[], extra: object = {}, maxTokens?: number) {
    try {
      return await super.chat(messages, extra, maxTokens);
    } catch (e: any) {
      if (e.cause?.code === "ECONNREFUSED" || /fetch failed/i.test(e.message)) {
        throw new Error(`Cannot reach Ollama at ${this.host}. Is it running? (\`ollama serve\`, then \`ollama pull ${this.model}\`)`);
      }
      throw e;
    }
  }
}

// ------------------------------------------------------------------ factory

export function getLLM(task?: Task): LLM {
  const r = taskRoute(task);
  switch (r.provider) {
    case "anthropic": return new AnthropicLLM(r.model);
    case "openrouter": return new OpenRouterLLM(r.model);
    case "ollama": return new OllamaLLM(r.model, llmSettings().ollamaHost);
  }
}

/** Models available for a provider, for the settings picker. */
export async function listModels(provider: Provider): Promise<{ id: string; label: string }[]> {
  const s = llmSettings();
  if (provider === "anthropic") {
    const out: { id: string; label: string }[] = [];
    try {
      for await (const m of anthropicClient().models.list()) out.push({ id: m.id, label: m.display_name });
    } catch (e: any) {
      if (/authentication|api-key|apiKey/i.test(e.message ?? "")) return [];
      throw e;
    }
    return out;
  }
  if (provider === "openrouter") {
    const res = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(15000) });
    const body: any = await res.json();
    return (body.data ?? [])
      .map((m: any) => ({ id: m.id, label: `${m.name}${m.context_length ? ` · ${Math.round(m.context_length / 1000)}k` : ""}` }))
      .sort((a: any, b: any) => a.id.localeCompare(b.id));
  }
  const res = await fetch(`${s.ollamaHost}/api/tags`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
  if (!res?.ok) return [];
  const body: any = await res.json();
  return (body.models ?? []).map((m: any) => ({ id: m.name, label: `${m.name}${m.details?.parameter_size ? ` · ${m.details.parameter_size}` : ""}` }));
}
