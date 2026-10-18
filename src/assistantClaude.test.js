import { buildAssistRequest } from "./assistant";
import { TOOL_NAME, readClaudeReply, toClaudeRequest } from "./assistantClaude";

/**
 * The web transport's two halves, read against the request `buildAssistRequest`
 * actually hands over — so the schema that reaches the forced tool is the same
 * one Ollama is given, and a reading pulled back out is the object
 * `resolveReading` expects.
 */

const budgets = [{ id: "groc", name: "Groceries" }];
const accounts = [{ id: "chk", name: "Checking" }];
const payees = [{ id: "cost", name: "Costco Wholesale" }];

test("the system turn becomes system, and the sentence stays a user turn", () => {
  const request = buildAssistRequest({ text: "45 at Costco", today: "2026-10-18", budgets, accounts, payees });
  const body = toClaudeRequest(request, { model: "claude-haiku-4-5" });

  expect(body.model).toBe("claude-haiku-4-5");
  expect(body.system).toContain("Known payees:");
  expect(body.messages).toEqual([{ role: "user", content: "45 at Costco" }]);
  // No system turn left among the messages — Anthropic keeps it separate.
  expect(body.messages.some((turn) => turn.role === "system")).toBe(false);
});

test("the household schema is the forced tool's input, unchanged", () => {
  const request = buildAssistRequest({ text: "x", budgets, accounts, payees });
  const body = toClaudeRequest(request, { model: "m" });

  expect(body.tool_choice).toEqual({ type: "tool", name: TOOL_NAME });
  expect(body.tools).toHaveLength(1);
  expect(body.tools[0].name).toBe(TOOL_NAME);
  expect(body.tools[0].input_schema).toBe(request.schema);
  // The category enum the schema offers is the household's, plus the pool.
  expect(body.tools[0].input_schema.properties.category.anyOf[0].enum).toContain("Groceries");
});

test("max_tokens is settable and defaulted", () => {
  const request = buildAssistRequest({ text: "x", budgets, accounts, payees });
  expect(toClaudeRequest(request, { model: "m" }).max_tokens).toBe(1024);
  expect(toClaudeRequest(request, { model: "m", maxTokens: 256 }).max_tokens).toBe(256);
});

test("a forced tool call is read as the reading", () => {
  const reading = { action: "add_transaction", amount: "45", payee: "Costco" };
  const reply = {
    content: [
      { type: "text", text: "" },
      { type: "tool_use", name: TOOL_NAME, input: reading },
    ],
  };
  expect(readClaudeReply(reply)).toBe(reading);
});

test("a reply that is not the forced tool is no reading", () => {
  expect(readClaudeReply({ content: [{ type: "text", text: "I can't." }] })).toBeNull();
  expect(readClaudeReply({ content: [{ type: "tool_use", name: "other", input: {} }] })).toBeNull();
  expect(readClaudeReply({ content: [{ type: "tool_use", name: TOOL_NAME, input: "nope" }] })).toBeNull();
  expect(readClaudeReply({})).toBeNull();
  expect(readClaudeReply(null)).toBeNull();
});
