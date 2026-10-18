/**
 * Claude, as the shape the proxy needs — the web transport's answer to
 * `electron/assist.js`.
 *
 * A pure module beside `src/assistant.js`, the same discipline: no network and
 * no secret (the serverless function around it holds both), so the test can
 * read it. It is the two halves of the hosted call that are not the model's:
 *
 *   `toClaudeRequest`  — turn the provider-neutral `{ messages, schema }` that
 *                        `buildAssistRequest` hands over into a Messages-API
 *                        body that **forces the one tool**, so the reply cannot
 *                        be anything but the schema's shape — the web mirror of
 *                        Ollama compiling the schema into a grammar.
 *   `readClaudeReply`  — pull that shape back out of the tool call. What comes
 *                        out is the model's reading and nothing more, checked
 *                        again by `resolveReading` against the live books.
 *
 * The schema is Ollama's `format` unchanged: JSON Schema with `enum`, nullable
 * `anyOf` and every field `required`, which is exactly what an Anthropic tool's
 * `input_schema` is, so the one schema serves both transports.
 */

/** The single tool the model is forced to call, so its reply is the reading. */
export const TOOL_NAME = "record";

const TOOL_DESCRIPTION = "Record what the sentence says, as the fields below.";

/**
 * The Messages-API body for a reading.
 *
 * The system turn becomes `system` (Anthropic keeps it out of `messages`), the
 * rest stay as they are, and the household schema is the forced tool's
 * `input_schema`. `model` and `max_tokens` come from the function, which owns
 * the account's one model rather than offering a pick as the desktop does.
 */
export function toClaudeRequest({ messages, schema }, { model, maxTokens = 1024 } = {}) {
  const turns = Array.isArray(messages) ? messages : [];
  const system = turns
    .filter((turn) => turn && turn.role === "system")
    .map((turn) => turn.content)
    .join("\n\n");
  const rest = turns
    .filter((turn) => turn && turn.role !== "system")
    .map((turn) => ({ role: turn.role, content: turn.content }));

  return {
    model,
    max_tokens: maxTokens,
    system,
    messages: rest,
    tools: [{ name: TOOL_NAME, description: TOOL_DESCRIPTION, input_schema: schema }],
    tool_choice: { type: "tool", name: TOOL_NAME },
  };
}

/**
 * The reading inside a reply, or null for a reply that carries none.
 *
 * Forcing the tool means the answer is a `tool_use` block whose `input` is the
 * schema-shaped object; anything else — a bare sentence, a refusal, a shape the
 * grammar somehow slipped — is null, which the caller reports as `bad-response`
 * rather than passing a non-object to `resolveReading`.
 */
export function readClaudeReply(response) {
  const blocks = response && Array.isArray(response.content) ? response.content : null;
  if (!blocks) return null;
  const call = blocks.find((block) => block && block.type === "tool_use" && block.name === TOOL_NAME);
  return call && call.input && typeof call.input === "object" ? call.input : null;
}
