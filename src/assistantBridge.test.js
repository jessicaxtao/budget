import { askAssistant, assistStatus } from "./assistantBridge";
import { isDesktop } from "./storage";
import { askAssistant as askDesktop, assistStatus as desktopStatus } from "./desktop";
import { getSupabase } from "./supabaseClient";

/**
 * Which model answers, by the one fact that tells the two transports apart.
 * The boundaries are mocked — the shell bridge, the Supabase client, the fetch
 * — so what is under test is only the choice and the shapes it keeps.
 */

jest.mock("./storage", () => ({ isDesktop: jest.fn() }));
jest.mock("./desktop", () => ({ assistStatus: jest.fn(), askAssistant: jest.fn() }));

// `isSupabaseConfigured` is a value, not a function; a getter over a mock-named
// holder lets a test say "this build has no project" without reassigning it.
var mockConfigured = { value: true };
jest.mock("./supabaseClient", () => ({
  get isSupabaseConfigured() {
    return mockConfigured.value;
  },
  getSupabase: jest.fn(),
}));

const request = { model: "m", messages: [{ role: "user", content: "45 at Costco" }], schema: { type: "object" } };

function withSession(token) {
  getSupabase.mockReturnValue({
    auth: { getSession: async () => ({ data: { session: token ? { access_token: token } : null } }) },
  });
}

beforeEach(() => {
  mockConfigured.value = true;
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.clearAllMocks();
  delete global.fetch;
});

describe("on the desktop", () => {
  beforeEach(() => isDesktop.mockReturnValue(true));

  test("both verbs are the shell's, untouched", async () => {
    desktopStatus.mockResolvedValue({ ok: true, models: ["qwen2.5:7b"] });
    askDesktop.mockResolvedValue({ ok: true, content: { action: "unknown" } });

    expect(await assistStatus()).toEqual({ ok: true, models: ["qwen2.5:7b"] });
    expect(await askAssistant(request)).toEqual({ ok: true, content: { action: "unknown" } });
    expect(askDesktop).toHaveBeenCalledWith(request);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("in a signed-in browser", () => {
  beforeEach(() => {
    isDesktop.mockReturnValue(false);
    withSession("tok");
  });

  test("status is hosted, with no model to pick", async () => {
    expect(await assistStatus()).toEqual({ ok: true, hosted: true, models: [] });
  });

  test("the sentence goes to /api/assist with the account's token, and the reading comes back", async () => {
    const content = { action: "add_transaction", amount: "45" };
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true, content }) });

    const result = await askAssistant(request);

    expect(result).toEqual({ ok: true, content });
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe("/api/assist");
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer tok");
    // The model name never leaves — the server owns it. Only the request does.
    expect(JSON.parse(init.body)).toEqual({ messages: request.messages, schema: request.schema });
  });

  test("the server's status maps to a reason the modal already reads", async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    expect(await askAssistant(request)).toEqual({ ok: false, reason: "signed-out" });

    global.fetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    expect(await askAssistant(request)).toEqual({ ok: false, reason: "unconfigured" });

    global.fetch.mockRejectedValue(new Error("offline"));
    expect((await askAssistant(request)).reason).toBe("unreachable");
  });
});

describe("with no session or no project", () => {
  beforeEach(() => isDesktop.mockReturnValue(false));

  test("a signed-out browser is asked to sign in, and nothing is sent", async () => {
    withSession(null);
    expect(await assistStatus()).toEqual({ ok: false, reason: "signed-out" });
    expect(await askAssistant(request)).toEqual({ ok: false, reason: "signed-out" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("an unconfigured build has no model to ask", async () => {
    mockConfigured.value = false;
    expect(await assistStatus()).toEqual({ ok: false, reason: "unsupported" });
    expect(await askAssistant(request)).toEqual({ ok: false, reason: "unsupported" });
  });
});
