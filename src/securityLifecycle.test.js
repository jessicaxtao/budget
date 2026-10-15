import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { AUTH_STATUS, AuthProvider, useAuth } from "./contexts/AuthContext";
import { BooksKeyProvider, useBooksKey, BOOKS_KEY_STATUS } from "./contexts/BooksKeyContext";
import { clearBooksKey, getBooksKey, setBooksKey } from "./booksKey";
import { newKeyRecord } from "./booksCrypto";
import { restoreScope, setStorageScope } from "./storage";

let mockListener;
let mockRow;
const mockUpsert = jest.fn();
const mockAuth = { getSession: jest.fn(), onAuthStateChange: jest.fn(), signOut: jest.fn() };
jest.mock("./supabaseClient", () => ({
  isSupabaseConfigured: true,
  getSupabase: () => ({
    auth: mockAuth,
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mockRow, error: null }) }) }),
      upsert: mockUpsert,
    }),
  }),
}));

const session = (id = "audit-user") => ({ user: { id } });
const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;
const keyWrapper = ({ children }) => <AuthProvider><BooksKeyProvider>{children}</BooksKeyProvider></AuthProvider>;
const cachedKey = () => localStorage.getItem("hb:audit-user:booksKey");

beforeEach(() => {
  localStorage.clear();
  setStorageScope(null);
  clearBooksKey();
  mockRow = null;
  mockAuth.getSession.mockResolvedValue({ data: { session: session() } });
  mockAuth.onAuthStateChange.mockImplementation((callback) => {
    mockListener = callback;
    return { data: { subscription: { unsubscribe: () => {} } } };
  });
  mockAuth.signOut.mockImplementation(async () => {
    mockListener("SIGNED_OUT", null);
    return { error: null };
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  localStorage.clear();
  setStorageScope(null);
  clearBooksKey();
});

function seedAccount() {
  restoreScope("audit-user", {
    transactions: [{ memo: "private record" }],
    pendingSync: { transactions: [{ memo: "unsent record" }] },
    booksKey: { raw: "synthetic-key", kid: "synthetic-id" },
    importDecision: "kept",
  });
  restoreScope(null, { budgets: [{ id: "local" }] });
  restoreScope("guest", { budgets: [{ id: "guest" }] });
  setBooksKey({ synthetic: true }, "synthetic-id");
}

function expectPurged() {
  for (const key of ["transactions", "pendingSync", "booksKey"]) {
    expect(localStorage.getItem(`hb:audit-user:${key}`)).toBeNull();
  }
  expect(getBooksKey()).toBeNull();
  expect(localStorage.getItem("budgets")).toContain("local");
  expect(localStorage.getItem("hb:guest:budgets")).toContain("guest");
  expect(localStorage.getItem("hb:audit-user:importDecision")).toContain("kept");
}

test.each(["SIGNED_OUT", "account switch"])("%s removes all session content and preserves local books", async (event) => {
  const view = renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(view.result.current.status).toBe(AUTH_STATUS.SIGNED_IN));
  seedAccount();
  await act(async () => mockListener(event === "SIGNED_OUT" ? event : "SIGNED_IN", event === "SIGNED_OUT" ? null : session("next-user")));
  expectPurged();
});

test("booting without a session removes orphaned account caches", async () => {
  seedAccount();
  mockAuth.getSession.mockResolvedValue({ data: { session: null } });
  const view = renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(view.result.current.status).toBe(AUTH_STATUS.SIGNED_OUT));
  expectPurged();
});

test("a late initial session read cannot undo a logout event", async () => {
  let resolveSession;
  mockAuth.getSession.mockReturnValue(new Promise((resolve) => { resolveSession = resolve; }));
  const view = renderHook(() => useAuth(), { wrapper });
  await act(async () => mockListener("SIGNED_OUT", null));
  await act(async () => resolveSession({ data: { session: session() } }));
  expect(view.result.current.status).toBe(AUTH_STATUS.SIGNED_OUT);
});

test.each([
  ["setUp", "deriveKey", "logout"],
  ["unlock", "deriveKey", "logout"],
  ["unlockWithRecoveryCode", "deriveKey", "logout"],
  ["unlock", "exportKey", "logout"],
  ["unlock", "exportKey", "unmount"],
  ["unlock", "exportKey", "account switch"],
])("%s interrupted during %s by %s cannot restore a key", async (method, cryptoMethod, interrupt) => {
  const password = "synthetic audit password";
  const created = await newKeyRecord(password);
  mockRow = method === "setUp" ? null : created.record;
  const view = renderHook(() => ({ auth: useAuth(), books: useBooksKey() }), { wrapper: keyWrapper });
  await waitFor(() => expect(view.result.current.books.status).toBe(method === "setUp" ? BOOKS_KEY_STATUS.SETUP : BOOKS_KEY_STATUS.LOCKED));

  let resume;
  let entered;
  const held = new Promise((resolve) => { resume = resolve; });
  const paused = new Promise((resolve) => { entered = resolve; });
  const original = crypto.subtle[cryptoMethod].bind(crypto.subtle);
  jest.spyOn(crypto.subtle, cryptoMethod).mockImplementationOnce(async (...args) => {
    const result = await original(...args);
    entered();
    await held;
    return result;
  });
  const pending = view.result.current.books[method](method === "unlockWithRecoveryCode" ? created.recoveryCode : password);
  await paused;
  if (interrupt === "unmount") view.unmount();
  else if (interrupt === "account switch") await act(async () => mockListener("SIGNED_IN", session("next-user")));
  else await act(async () => view.result.current.auth.signOut());

  await act(async () => {
    resume();
    expect((await pending).ok).toBe(false);
  });
  expect(cachedKey()).toBeNull();
  expect(getBooksKey()).toBeNull();
  expect(mockUpsert).not.toHaveBeenCalled();
});
