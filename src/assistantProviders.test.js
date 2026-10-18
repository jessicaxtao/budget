import { buildAssistRequest } from "./assistant";
import { PROVIDERS, TOOL_NAME, buildProviderRequest, readProviderReply } from "./assistantProviders";

/**
 * Each hosted provider's two halves, read against the request
 * `buildAssistRequest` actually hands over — so the schema that reaches the
 * forced tool is the one Ollama is given, and a reading pulled back out is the
 * object `resolveReading` expects.
 */

const budgets = [{ id: "groc", name: "Groceries" }];
const accounts = [{ id: "chk", name: "Checking" }];
const payees = [{ id: "cost", name: "Costco Wholesale" }];
const request = () => buildAssistRequest({ text: "45 at Costco", today: "2026-10-18", budgets, accounts, payees });

describe("anthropic", () => {
  test("forces the record tool with the household schema and the key", () => {
    const req = request();
    const built = buildProviderRequest("anthropic", { ...req, model: "claude-haiku-4-5", key: "sk-ant-xyz" });

    expect(built.url).toBe("https://api.anthropic.com/v1/messages");
    expect(built.headers["x-api-key"]).toBe("sk-ant-xyz");
    expect(built.headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    expect(built.body.model).toBe("claude-haiku-4-5");
    expect(built.body.tool_choice).toEqual({ type: "tool", name: TOOL_NAME });
    expect(built.body.tools[0].input_schema).toBe(req.schema);
    expect(built.body.system).toContain("Known payees:");
    expect(built.body.messages).toEqual([{ role: "user", content: "45 at Costco" }]);
  });

  test("reads the forced tool call back out, and nothing else", () => {
    const reading = { action: "add_transaction", amount: "45" };
    expect(readProviderReply("anthropic", { content: [{ type: "tool_use", name: TOOL_NAME, input: reading }] })).toBe(
      reading
    );
    expect(readProviderReply("anthropic", { content: [{ type: "text", text: "I can't." }] })).toBeNull();
  });

  test("defaults the model when none is given", () => {
    expect(buildProviderRequest("anthropic", { ...request(), key: "k" }).body.model).toBe(
      PROVIDERS.anthropic.defaultModel
    );
  });
});

describe("openai", () => {
  test("forces the record function with the schema and a bearer key", () => {
    const req = request();
    const built = buildProviderRequest("openai", { ...req, model: "gpt-4o-mini", key: "sk-abc" });

    expect(built.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(built.headers.authorization).toBe("Bearer sk-abc");
    expect(built.body.tool_choice).toEqual({ type: "function", function: { name: TOOL_NAME } });
    expect(built.body.tools[0].function.parameters).toBe(req.schema);
    // OpenAI keeps the system turn in messages.
    expect(built.body.messages[0].role).toBe("system");
    expect(built.body.messages[1]).toEqual({ role: "user", content: "45 at Costco" });
  });

  test("reads the function arguments (a JSON string) back out", () => {
    const reading = { action: "move_money", amount: "50" };
    const reply = { choices: [{ message: { tool_calls: [{ function: { name: TOOL_NAME, arguments: JSON.stringify(reading) } }] } }] };
    expect(readProviderReply("openai", reply)).toEqual(reading);
    expect(readProviderReply("openai", { choices: [{ message: { content: "hi" } }] })).toBeNull();
    const broken = { choices: [{ message: { tool_calls: [{ function: { name: TOOL_NAME, arguments: "{bad" } }] } }] };
    expect(readProviderReply("openai", broken)).toBeNull();
  });
});

test("an unknown provider builds and reads nothing", () => {
  expect(buildProviderRequest("nope", request())).toBeNull();
  expect(readProviderReply("nope", {})).toBeNull();
});
