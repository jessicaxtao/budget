# Security review

Remediation (2026-10-14): the three findings below are fixed in the working tree.
Auth transitions now purge account caches and invalidate pending key/sync work;
desktop backups exclude account data and migrate existing backups; preload
bootstrap data is consumable. Regression tests cover logout, account changes,
startup without a session, interrupted setup/password/recovery unlock, delayed
key export, late failed uploads, and both desktop copies. Electron now validates
IPC senders and exact origins. React Router is updated to 7.18.4 and
webpack-dev-server to 5.2.6, with a CRA configuration adapter that preserves host
and origin checks and removes wildcard CORS. Direct HTTP checks returned 200 for
the app/deep links and 403 for cross-site scripts and spoofed Host headers.

Compatible dependency updates reduced `npm audit` from 120 affected entries to
105 (0 critical, 62 high, 40 moderate, 3 low). Remaining alerts concern the legacy
development/build/test/packaging dependency tree; this is not a clean dependency audit.
Further major tooling migrations are outside these targeted security fixes.
The original findings and reproduction results below describe the pre-fix code.

Final verification: all 71 suites passed (1,440 tests passed, one platform-specific
test skipped), `npm run build` compiled successfully, and `git diff --check`
passed. The patched development server compiled and passed the HTTP checks above;
its remaining audit entry is inherited through development dependencies, not the
source-disclosure advisory. No deployment or live Supabase changes were made.

Reviewed on 2026-10-14 against commit `9479195`. Three confirmed medium-severity findings concern account data and key retention after logout. No critical remote exploit was established in the reviewed code. Severity reflects the need for access to the same browser or OS profile, or script execution in the app origin; these findings do not establish access across unrelated Supabase accounts.

Scope: React authentication and storage lifecycle, cloud encryption and sync, Supabase SQL policies, receipt and import handling, Electron preload/IPC/filesystem/network boundaries, deployment headers, and dependency advisories. Review used source inspection, synthetic local reproductions, selected existing tests, and `npm audit`. No live account data was accessed and no production service was probed. Application code and dependencies were not changed.

## 1. Automatic logout leaves account data and the master key behind

**Medium; confirmed.** Location: `src/contexts/AuthContext.js:325`, especially line 329 and the state changes at lines 338–339. Compare the explicit cleanup at lines 513–530.

The auth event listener responds to `SIGNED_OUT` by changing React state but does not call `clearScope` or `clearBooksKey`. Cleanup only happens through the app's explicit `signOut` and `stopSyncing` methods. A revoked session or terminal refresh failure can therefore return the app to its sign-in screen while the former account's plaintext documents, pending writes, and raw master key remain in local storage or the desktop books file. The module-level key also survives. Supabase supports global sign-out affecting other devices; those devices can lose their sessions during later refresh attempts. See [Supabase sign-out behavior](https://supabase.com/docs/guides/auth/signout).

Reproduction: mount the real AuthProvider with a synthetic signed-in session, seed `hb:audit-user:transactions` and `hb:audit-user:booksKey`, set a synthetic in-memory key, then deliver `SIGNED_OUT` with a null session. Auth status becomes signed out while both storage records and `getBooksKey()` remain populated.

Impact: someone with subsequent access to that browser/OS profile can recover the former user's financial data and key after the UI indicates the session ended. This violates the intended cleanup boundary documented in `storage.js`; it is distinct from the intentional plaintext cache while signed in.

Fix: track the previous account independently of the incoming session, centralize cleanup on every transition away from that account, clear the in-memory key, cancel account work, and flush desktop removals. Preserve intentionally retained guest books. Cover revoked sessions, cross-tab events, direct account switches, and startup without a valid session. Keep Supabase API calls outside its auth callback if they would re-enter its auth lock.

## 2. Desktop cleanup misses the backup and exposed startup snapshot

**Medium; confirmed.** Locations: `electron/books.js:258` (backup creation at line 262), `electron/preload.js:26` and line 30, and `src/storage.js:527`.

`clearScope` removes account entries from the active storage backend. However, the first disk write in a process copies the previous `books.json` wholesale to `books.bak.json`. That previous file can contain both plaintext account documents and `hb:<uid>:booksKey.raw`. Logout never scrubs the backup. When logout causes the first write after a restart, the cleanup write itself creates a backup of the sensitive data it is removing.

Independently, preload publishes the complete startup documents as `window.__hbDesktop.snapshot`. That copied object remains accessible after writes/removals update the active backend. A desktop session started with cached account books therefore retains those startup books and keys in the renderer bridge after logout, until the page is destroyed.

Reproduction: create a temporary books file containing only synthetic account transactions and a synthetic cached key; load the real books module and preload with a stubbed Electron bridge; remove both records and flush. Results:

```text
active books.json keys: []
books.bak.json keys: [account transactions, account booksKey]
preload snapshot keys: [account transactions, account booksKey]
```

Impact: local access can recover account data after a successful explicit logout. A renderer script can also read the startup snapshot without accessing the filesystem. No renderer injection was established during this review.

Fix: exclude disposable signed-in account caches and raw keys from durable local-book backups, and migrate existing backups to remove those entries without removing guest books. Provide the bootstrap data through a consumable bridge operation instead of a permanently exposed property. Clear/recreate the renderer when necessary, and verify the backup, active file, backend cache, and bridge after logout and relaunch.

## 3. An in-flight unlock can restore a key after logout

**Medium; confirmed.** Location: `src/contexts/BooksKeyContext.js:250`, with unconditional key installation/cache writes at lines 260–262. The recovery-code path at lines 270–289 has the same pattern.

Unlock performs asynchronous key derivation and unwrap, then installs and persists the master key without checking that the provider is still mounted or the initiating account/session is current. The initial key-loading effect has an `active` guard; these mutators do not. An unlock started before a logout can finish after cleanup and write the key back. A logout from another tab while this tab is unlocking is a relevant lifecycle scenario.

Reproduction: use a real generated key record and real WebCrypto; start `unlock`, complete explicit sign-out, verify the cached key is absent, unmount the provider, then await the pending unlock. It returns success and both the persisted raw key and the module-level key are present again. The test exercised real providers with a mocked Supabase transport, not a live browser cross-tab session.

Fix: give account/session work a generation identifier and invalidate it on logout, account changes, and unmount. Recheck it after asynchronous operations and immediately before both in-memory and persistent writes, including the asynchronous export inside `cacheKey`. Apply the same cancellation discipline to setup and recovery unlock. Test logout/account-switch races with deterministic deferred operations.

## Dependency findings and additional hardening

`npm audit` reported **120 affected package entries: 3 critical, 71 high, 43 moderate, 3 low**. These include transitive effects and are not 120 distinct exploitable application flaws. `react-scripts` is listed as a production dependency even though much of its dependency tree serves build, test, and development tasks.

- Installed `webpack-dev-server@4.15.2`, through `react-scripts@5.0.1`, is affected by a documented source-disclosure attack while a developer visits a malicious website with the dev server running. Both `npm start` and `npm run desktop` use this server. Plan a compatible toolchain upgrade and reassess all current advisories; production static hosting does not run this server. This review did not execute that exploit. [Maintainer advisory](https://github.com/webpack/webpack-dev-server/security/advisories/GHSA-4v9v-hfq4-rm2v).
- Installed React Router packages are `6.30.4`; audit flags redirect/XSS advisories. Reviewed links use fixed application routes, and no untrusted redirect destination or SSR hydration path was found. Update to a patched, supported combination, but current findings do not establish exploitable routing XSS in this app. [Redirect advisory](https://github.com/remix-run/react-router/security/advisories/GHSA-jjmj-jmhj-qwj2), [untrusted-path advisory](https://github.com/remix-run/react-router/security/advisories/GHSA-wrjc-x8rr-h8h6).
- Electron IPC handlers at `electron/main.js:411` onward do not validate the sending frame; navigation at line 356 uses a URL prefix comparison. Require the expected WebContents/main frame and exact parsed scheme/host/port. Also restrict the custom protocol to its intended host. These are hardening gaps; this review did not establish an attacker-controlled page reaching privileged IPC under the existing content policy and request filter. [Electron security guidance](https://github.com/electron/electron/blob/main/docs/tutorial/security.md).

## Existing protections and validation limits

The checked-in SQL enables row-level security with ownership checks on both account tables and user-folder checks on the private receipts bucket. New cloud documents and receipts use AES-GCM; password-derived wrapping uses PBKDF2-SHA-256 with 600,000 iterations. Web deployment configuration includes restrictive script/connect policies and anti-framing headers. Electron enables context isolation, sandboxing, and disables renderer Node integration. Receipt disk writes constrain IDs, extensions, and size. No direct HTML injection sink was found in the reviewed renderer code, and `.env.local` is not tracked.

Plaintext local caches and local receipts are an explicit design choice; cloud encryption does not provide local at-rest protection. Legacy unencrypted cloud receipts are still accepted, so existing accounts require a separate migration assessment before describing all historical receipts as encrypted.

Validation: **11 selected suites passed, 207 tests passed, 1 skipped**, including two temporary vulnerability reproduction tests. The separate desktop reproduction confirmed backup and startup-snapshot retention using synthetic files, then removed those files. Temporary audit tests were removed after the run; the existing test suite was not modified. Passing reproduction tests mean the described vulnerabilities occurred, not that security requirements passed.

Live Supabase policies/grants, authentication settings, actual hosted headers, packaged Electron behavior, installer signing, and production secrets were not verified. Source policies and header configuration alone cannot establish that the deployed services match them.
