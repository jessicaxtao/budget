import { askAssistant, assistStatus } from "./assistantBridge";
import { isDesktop } from "./storage";
import { askAssistant as askOllama, assistStatus as ollamaStatus, providerFetch } from "./desktop";

/**
 * Which model answers, by the household's settings. The boundaries are mocked
 * — the shell bridge, the desktop fetch, the browser's fetch — so what is under
 * test is only the choice of transport and the shapes it keeps. The settings
 * themselves are real, read from `localStorage`.
 */

jest.mock("./storage", () => ({ isDesktop: jest.fn() }));
jest.mock("./desktop", () => ({
  assistStatus: jest.fn(),
  askAssistant: jest.fn(),
  providerFetch: jest.fn(),
}));

const messages = [
  { role: "system", content: "sys" },
  { role: "user", content: "45 at Costco" },
];
const schema = { type: "object" };

const setConfig = (config) => localStorage.setItem("assistConfig", JSON.stringify(config));

beforeEach(() => {
  localStorage.clear();
  global.fetch = jest.fn();
});
afterEach(() => {
  jest.clearAllMocks();
  delete global.fetch;
});

describe("the desktop's local model", () => {
  beforeEach(() => isDesktop.mockReturnValue(true));

  test("an unconfigured desktop is Ollama, through the shell, untouched", async () => {
    ollamaStatus.mockResolvedValue({ ok: true, models: ["qwen2.5:7b"] });
    askOllama.mockResolvedValue({ ok: true, content: { action: "unknown" } });

    expect(await assistStatus()).toEqual({ ok: true, models: ["qwen2.5:7b"] });
    expect(await askAssistant({ model: "qwen2.5:7b", messages, schema })).toEqual({
      ok: true,
      content: { action: "unknown" },
    });
    expect(askOllama).toHaveBeenCalledWith({ model: "qwen2.5:7b", messages, schema });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("a hosted model the household keyed", () => {
  test("an unconfigured browser has a provider but no key, so it asks to be set up", async () => {
    isDesktop.mockReturnValue(false);
    expect(await assistStatus()).toEqual({ ok: false, reason: "no-key", provider: "anthropic" });
    expect(await askAssistant({ messages, schema })).toEqual({ ok: false, reason: "no-key" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("a keyed browser calls the provider straight, with the key and the forced tool", async () => {
    isDesktop.mockReturnValue(false);
    setConfig({ provider: "anthropic", keys: { anthropic: "sk-ant-1" }, models: {} });
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: "tool_use", name: "record", input: { action: "add_transaction" } }] }),
    });

    expect(await assistStatus()).toEqual({ ok: true, hosted: true, provider: "anthropic", model: "claude-haiku-4-5" });

    const result = await askAssistant({ messages, schema });
    expect(result).toEqual({ ok: true, content: { action: "add_transaction" } });
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers["x-api-key"]).toBe("sk-ant-1");
    expect(JSON.parse(init.body).tool_choice).toEqual({ type: "tool", name: "record" });
  });

  test("OpenAI is reached at its own endpoint when chosen", async () => {
    isDesktop.mockReturnValue(false);
    setConfig({ provider: "openai", keys: { openai: "sk-o" }, models: {} });
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { tool_calls: [{ function: { name: "record", arguments: '{"action":"unknown"}' } }] } }],
      }),
    });

    expect(await askAssistant({ messages, schema })).toEqual({ ok: true, content: { action: "unknown" } });
    expect(global.fetch.mock.calls[0][0]).toBe("https://api.openai.com/v1/chat/completions");
  });

  test("a refused key is said as such", async () => {
    isDesktop.mockReturnValue(false);
    setConfig({ provider: "anthropic", keys: { anthropic: "bad" }, models: {} });
    global.fetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    expect(await askAssistant({ messages, schema })).toEqual({ ok: false, reason: "bad-key" });
  });

  test("on the desktop the hosted call goes through main, never the renderer's fetch", async () => {
    isDesktop.mockReturnValue(true);
    setConfig({ provider: "anthropic", keys: { anthropic: "sk-ant-1" }, models: {} });
    providerFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: { content: [{ type: "tool_use", name: "record", input: { action: "unknown" } }] },
    });

    expect(await assistStatus()).toEqual({ ok: true, hosted: true, provider: "anthropic", model: "claude-haiku-4-5" });
    expect(await askAssistant({ messages, schema })).toEqual({ ok: true, content: { action: "unknown" } });
    expect(providerFetch).toHaveBeenCalledTimes(1);
    expect(providerFetch.mock.calls[0][0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(global.fetch).not.toHaveBeenCalled();
    expect(ollamaStatus).not.toHaveBeenCalled();
  });
});
