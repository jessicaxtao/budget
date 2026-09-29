const mockCreateClient = jest.fn(() => ({ auth: {} }));

jest.mock("@supabase/supabase-js", () => ({
  createClient: (...args) => mockCreateClient(...args),
}));

/**
 * The lazy half of "nothing is sent anywhere".
 *
 * The sign-in page tells a desktop household that a local session makes no
 * requests, and there are two things that have to be true for that: nothing in
 * local mode may *reach* for the client (pinned in `AuthContext.test.js`, where
 * a guest never calls `getSupabase` and never gets a session listener), and
 * reaching for it has to be the only thing that builds one. This file is the
 * second half.
 *
 * It matters because building the client is not inert: `persistSession` reads
 * and writes localStorage, `autoRefreshToken` starts a timer that goes to the
 * network when a stored token ages, and `detectSessionInUrl` parses the URL.
 * Built at module load — as it used to be — all of that happened to every
 * session on a configured build, whether or not it had anything to do with an
 * account.
 *
 * The credentials have to be staged *before* the module is evaluated, since it
 * reads them once at the top. Hence `isolateModules` plus `require` rather than
 * an import: an import would be hoisted above the assignment and the module
 * would read an unconfigured build every time.
 */
function withCredentials(run, { configured = true } = {}) {
  const before = {
    url: process.env.REACT_APP_SUPABASE_URL,
    key: process.env.REACT_APP_SUPABASE_ANON_KEY,
  };

  if (configured) {
    process.env.REACT_APP_SUPABASE_URL = "https://example.supabase.co";
    process.env.REACT_APP_SUPABASE_ANON_KEY = "test-anon-key";
  } else {
    delete process.env.REACT_APP_SUPABASE_URL;
    delete process.env.REACT_APP_SUPABASE_ANON_KEY;
  }

  try {
    jest.isolateModules(() => run(require("./supabaseClient")));
  } finally {
    process.env.REACT_APP_SUPABASE_URL = before.url;
    process.env.REACT_APP_SUPABASE_ANON_KEY = before.key;
  }
}

beforeEach(() => {
  mockCreateClient.mockClear();
  mockCreateClient.mockImplementation(() => ({ auth: {} }));
});

test("a configured build that never asks builds nothing", () => {
  withCredentials(({ isSupabaseConfigured }) => {
    // Configured is a fact about the build, and asking must stay free — this is
    // the check `SyncContext` makes on every render.
    expect(isSupabaseConfigured).toBe(true);
    expect(mockCreateClient).not.toHaveBeenCalled();
  });
});

test("asking is what builds it", () => {
  withCredentials(({ getSupabase }) => {
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(getSupabase()).not.toBeNull();
    expect(mockCreateClient).toHaveBeenCalledTimes(1);
  });
});

test("it is built once and shared, not once per caller", () => {
  withCredentials(({ getSupabase }) => {
    expect(getSupabase()).toBe(getSupabase());
    expect(mockCreateClient).toHaveBeenCalledTimes(1);
  });
});

test("the session options are the ones the recovery flow depends on", () => {
  withCredentials(({ getSupabase }) => {
    getSupabase();
    const [url, key, options] = mockCreateClient.mock.calls[0];
    expect(url).toBe("https://example.supabase.co");
    expect(key).toBe("test-anon-key");
    expect(options.auth).toEqual({
      persistSession: true,
      autoRefreshToken: true,
      // The reset link comes back as a URL fragment the client has to consume.
      detectSessionInUrl: true,
    });
  });
});

test("an unconfigured build hands back null rather than building one", () => {
  withCredentials(
    ({ isSupabaseConfigured, getSupabase }) => {
      expect(isSupabaseConfigured).toBe(false);
      expect(getSupabase()).toBeNull();
      expect(mockCreateClient).not.toHaveBeenCalled();
    },
    { configured: false }
  );
});
