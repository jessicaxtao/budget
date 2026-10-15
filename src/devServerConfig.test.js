const adapt = require("../scripts/devServerConfig");

test("CRA's helpers stay behind the dev server's origin checks", () => {
  const before = () => {};
  const after = () => {};
  const config = adapt({
    https: false, allowedHosts: "all", headers: { "Access-Control-Allow-Origin": "*" },
    devMiddleware: { publicPath: "" },
    onBeforeSetupMiddleware: (server) => server.app.use(before),
    onAfterSetupMiddleware: (server) => server.app.use("/worker", after),
  });
  const stack = [{ name: "host-header-check" }, { name: "cross-origin-header-check" }, { name: "webpack-dev-middleware" }];
  const middleware = config.setupMiddlewares(stack, { app: { use: () => { throw new Error("bypassed origin checks"); } } });
  expect(middleware.map((entry) => entry.name ?? entry.middleware)).toEqual([
    "host-header-check", "cross-origin-header-check", before, "webpack-dev-middleware", after,
  ]);
  expect(config.allowedHosts).toBe("auto");
  expect(config.headers["Access-Control-Allow-Origin"]).toBeUndefined();
  expect(config.devMiddleware.publicPath).toBe("/");
  expect(config.onBeforeSetupMiddleware).toBeUndefined();
});
