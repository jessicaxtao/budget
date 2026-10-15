const fs = require("fs");
const vm = require("vm");
const path = require("path");
const { sameOrigin, trustedSender } = require("../electron/security");

test("preload exposes a consumable bootstrap, never a permanent copy of account data", () => {
  let bridge;
  const sendSync = jest.fn(() => ({ documents: { "hb:user:booksKey": { raw: "synthetic" } }, path: "books.json" }));
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../electron/preload.js"), "utf8"), {
    require: () => ({ contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } }, ipcRenderer: { sendSync } }),
  });
  expect(bridge.snapshot).toBeUndefined();
  expect(bridge.takeSnapshot()).toEqual({ "hb:user:booksKey": { raw: "synthetic" } });
  expect(bridge.takeSnapshot()).toEqual({});
  expect(sendSync).toHaveBeenCalledTimes(1);
});

test.each(["app://books.evil/index.html", "app://books:123/index.html", "app://user@books/index.html", "https://books/index.html", "not a URL"])("rejects an unexpected application origin: %s", (url) => {
  expect(sameOrigin(url, "app://books")).toBe(false);
});

test("IPC only trusts the registered window's main frame at the exact app origin", () => {
  const frame = { url: "app://books/transactions" };
  const sender = { mainFrame: frame, isDestroyed: () => false };
  const trusted = new WeakSet([sender]);
  expect(trustedSender({ sender, senderFrame: frame }, trusted, "app://books")).toBe(true);
  expect(trustedSender({ sender, senderFrame: { ...frame } }, trusted, "app://books")).toBe(false);
  expect(trustedSender({ sender, senderFrame: frame }, new WeakSet(), "app://books")).toBe(false);
  frame.url = "app://books.evil/";
  expect(trustedSender({ sender, senderFrame: frame }, trusted, "app://books")).toBe(false);
  expect(sameOrigin("http://localhost:30001", "http://localhost:3000")).toBe(false);
});
