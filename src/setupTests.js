// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// jsdom 16 (bundled with react-scripts 5) implements no <dialog> behaviour at
// all, so every modal throws "showModal is not a function" the moment a test
// opens one. Polyfill just enough for Dialog.js: open/close state plus the
// `close` event it subscribes to. Guarded so a future jsdom that implements
// <dialog> natively wins instead.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };

  HTMLDialogElement.prototype.show = function show() {
    this.open = true;
  };

  HTMLDialogElement.prototype.close = function close(returnValue) {
    if (!this.open) return;
    this.open = false;
    if (returnValue !== undefined) this.returnValue = returnValue;
    this.dispatchEvent(new Event('close'));
  };
}

// jsdom 16 (bundled with react-scripts 5) ships no `crypto` at all — not
// `getRandomValues`, not `subtle` — so nothing in `booksCrypto.js` runs
// without a polyfill. Node's own `crypto.webcrypto` is the real
// implementation jsdom is missing, not a stand-in for it, so a test
// exercises the same AES-GCM and PBKDF2 a browser would. Guarded so a
// future jsdom that implements WebCrypto natively wins instead, and defined
// through `Object.defineProperty` because a plain assignment to a jsdom
// global that already has a (empty) `crypto` getter is refused.
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.subtle) {
  const { webcrypto } = require('node:crypto');
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
  });
}

// jsdom 16 also ships no `TextEncoder` / `TextDecoder`, which every document
// `booksCrypto.js` seals or opens goes through on its way to and from
// `crypto.subtle` — without this the WebCrypto polyfill above has nothing
// to encrypt. Node's `util` module is the same global class every browser
// exposes, not a shim of it. Guarded the same way, for a future jsdom that
// adds them itself.
if (typeof globalThis.TextEncoder === 'undefined' || typeof globalThis.TextDecoder === 'undefined') {
  const { TextEncoder, TextDecoder } = require('node:util');
  globalThis.TextEncoder = TextEncoder;
  globalThis.TextDecoder = TextDecoder;
}
