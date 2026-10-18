/**
 * The hosted models the household can bring a key to, as request-building and
 * reply-reading — the web-and-desktop answer to `electron/assist.js`'s Ollama.
 *
 * A pure module beside `src/assistant.js`: no network, no storage, no secret of
 * its own (the key is passed in, used to build one request, and never kept),
 * so the test can read it. For each provider it knows the endpoint, how to turn
 * the provider-neutral `{ messages, schema }` from `buildAssistRequest` into a
 * call that **forces one tool** — so the reply can only be the schema's shape,
 * the hosted analogue of Ollama compiling the schema into a grammar — and how
 * to read the forced call back out.
 *
 * The same schema serves every transport: JSON Schema with `enum`, nullable
 * `anyOf` and every field `required`, which is exactly an Anthropic tool's
 * `input_schema` and an OpenAI function's `parameters`.
 */

/** The one tool the model is forced to call, so its reply is the reading. */
export const TOOL_NAME = "record";

const TOOL_DESCRIPTION = "Record what the sentence says, as the fields below.";

/** Split the neutral turns into Anthropic's system string and the rest. */
function anthropicTurns(messages) {
  const turns = Array.isArray(messages) ? messages : [];
  return {
    system: turns.filter((t) => t && t.role === "system").map((t) => t.content).join("\n\n"),
    rest: turns.filter((t) => t && t.role !== "system").map((t) => ({ role: t.role, content: t.content })),
  };
}

export const PROVIDERS = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    model: "Claude",
    defaultModel: "claude-haiku-4-5",
    keyHint: "A key from console.anthropic.com, starting “sk-ant-”.",
    endpoint: "https://api.anthropic.com/v1/messages",
    build({ messages, schema, model, key }) {
      const { system, rest } = anthropicTurns(messages);
      return {
        url: this.endpoint,
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          // Required for the call to be allowed from a browser; ignored by the
          // API when the caller is the desktop's main process.
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: {
          model: model || this.defaultModel,
          max_tokens: 1024,
          system,
          messages: rest,
          tools: [{ name: TOOL_NAME, description: TOOL_DESCRIPTION, input_schema: schema }],
          tool_choice: { type: "tool", name: TOOL_NAME },
        },
      };
    },
    read(json) {
      const blocks = json && Array.isArray(json.content) ? json.content : null;
      if (!blocks) return null;
      const call = blocks.find((b) => b && b.type === "tool_use" && b.name === TOOL_NAME);
      return call && call.input && typeof call.input === "object" ? call.input : null;
    },
  },

  openai: {
    id: "openai",
    label: "OpenAI",
    model: "ChatGPT",
    defaultModel: "gpt-4o-mini",
    keyHint: "A key from platform.openai.com, starting “sk-”.",
    endpoint: "https://api.openai.com/v1/chat/completions",
    build({ messages, schema, model, key }) {
      const turns = (Array.isArray(messages) ? messages : []).map((t) => ({ role: t.role, content: t.content }));
      return {
        url: this.endpoint,
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: {
          model: model || this.defaultModel,
          temperature: 0,
          messages: turns,
          tools: [{ type: "function", function: { name: TOOL_NAME, description: TOOL_DESCRIPTION, parameters: schema } }],
          tool_choice: { type: "function", function: { name: TOOL_NAME } },
        },
      };
    },
    read(json) {
      const calls = json?.choices?.[0]?.message?.tool_calls;
      const call = Array.isArray(calls) ? calls.find((c) => c?.function?.name === TOOL_NAME) : null;
      if (!call) return null;
      try {
        const parsed = JSON.parse(call.function.arguments);
        return parsed && typeof parsed === "object" ? parsed : null;
      } catch {
        return null;
      }
    },
  },
};

/** The provider ids, for a picker and a default. */
export const PROVIDER_IDS = Object.keys(PROVIDERS);

/** The `{ url, headers, body }` a reading needs, or null for an unknown id. */
export function buildProviderRequest(providerId, { messages, schema, model, key }) {
  const provider = PROVIDERS[providerId];
  if (!provider) return null;
  return provider.build({ messages, schema, model, key });
}

/** The reading inside a provider's reply, or null for one that carries none. */
export function readProviderReply(providerId, json) {
  const provider = PROVIDERS[providerId];
  if (!provider) return null;
  return provider.read(json);
}
