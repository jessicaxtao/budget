// The Grove's mode, decided before the first paint.
//
// **A file rather than an inline script, and that is a CSP decision.** Neither
// policy allows `unsafe-inline` for scripts — `vercel.json` for the web deploy,
// `contentSecurityPolicy()` in `electron/main.js` for the shell — so an inline
// block would have to be named by its sha256 in both. That hash could not be
// taken from this source: CRA's production build runs index.html through
// html-webpack-plugin with `minifyJS` and `collapseWhitespace` on, so the bytes
// the browser hashes are the *minified* ones. The hash would therefore be an
// artifact of the build, hand-copied into two policies written in two different
// languages, silently wrong the moment anybody touched a character in here.
//
// Served from the app's own origin it needs none of that: `script-src 'self'`
// already covers it in both policies, and there is nothing to keep in step.
// The cost is one small same-origin request, which is a local read under
// `app://` and a cached one on the web.
//
// It must stay **blocking** — no `defer`, no `async`, no `type="module"` — or
// it runs after the first paint and the flash it exists to prevent comes back.
//
// Mirrors `useTheme`: a stored choice wins, and with none the system decides.
// The key is read bare and holds JSON, which is that hook's own contract — the
// mode is a preference about the screen, not one of the books, so it sits
// outside the per-account namespacing in `src/storage.js` and survives a
// sign-out. The two read the same key the same way, so they cannot disagree.
(function () {
  var theme = null;
  try {
    theme = JSON.parse(localStorage.getItem("theme"));
  } catch (e) {}
  if (theme !== "light" && theme !== "dark") {
    theme =
      window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  }
  document.documentElement.setAttribute("data-theme", theme);
})();
