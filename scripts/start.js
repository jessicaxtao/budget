// CRA 5's build/test setup remains useful, but its dev-server configuration
// uses options removed in the patched v5 server. Adapt those options here.
process.env.BABEL_ENV = "development";
process.env.NODE_ENV = "development";
process.env.HOST = process.env.HOST || "localhost";
require("react-scripts/config/env");

const configPath = require.resolve("react-scripts/config/webpackDevServer.config");
const originalConfig = require(configPath);
const adaptDevServer = require("./devServerConfig");
require.cache[configPath].exports = (...args) => adaptDevServer(originalConfig(...args));
// CRA's shutdown handlers still use the v4 name.
const DevServer = require("webpack-dev-server");
DevServer.prototype.close = DevServer.prototype.stopCallback;
require("react-scripts/scripts/start");
