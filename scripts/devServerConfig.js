module.exports = function adaptDevServer(legacy) {
  const { https, onBeforeSetupMiddleware, onAfterSetupMiddleware, ...config } = legacy;
  config.server = https ? { type: "https", options: https === true ? {} : https } : "http";
  config.allowedHosts = "auto";
  // CRA enables wildcard CORS even without a proxy; budget assets need none.
  config.headers = { "Cross-Origin-Resource-Policy": "same-origin" };
  config.devMiddleware = { ...config.devMiddleware, publicPath: "/" };
  if (!config.proxy) delete config.proxy;
  config.setupMiddlewares = (middlewares, server) => {
    // Preserve CRA's before/after ordering without installing middleware ahead
    // of webpack-dev-server's host and origin checks.
    const collect = (setup) => {
      const collected = [];
      const facade = Object.create(server);
      facade.app = Object.create(server.app);
      facade.app.use = (...args) => {
        const route = typeof args[0] === "string" ? args.shift() : undefined;
        for (const middleware of args.flat()) collected.push({ path: route, middleware });
        return facade.app;
      };
      setup?.(facade);
      return collected;
    };
    const firstAsset = middlewares.findIndex(({ name }) => name === "webpack-dev-middleware");
    middlewares.splice(firstAsset < 0 ? middlewares.length : firstAsset, 0, ...collect(onBeforeSetupMiddleware));
    middlewares.push(...collect(onAfterSetupMiddleware));
    return middlewares;
  };
  return config;
};
