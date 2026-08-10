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
