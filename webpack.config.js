const common_options = {
  mode: "development",
  stats: {
    orphanModules: true,
  },
  devtool: "source-map",
  optimization: {mangleExports: false}
}

const webpack_configs = [
  {
    name: "client",
    entry: "./src/entrypoints/client.mjs",
    output: {
      filename: "wisp-client.js",
      library: {
        name: "wisp_client",
        type: "var"
      }
    },
    ...common_options
  },
  {
    name: "server",
    entry: "./src/entrypoints/server.mjs",
    output: {
      filename: "wisp-server.js",
      library: {
        name: "wisp_server",
        type: "var"
      }
    },
    ...common_options
  },
  {
    name: "full",
    entry: "./src/index.mjs",
    output: {
      filename: "wisp-full.js",
      library: {
        name: "wisp_full",
        type: "var"
      }
    },
    ...common_options
  }
]

//add es6 and commonjs module output to each webpack configuration object
let new_configs = [];
for (let config of webpack_configs) {
  let legacy_config = {
    ...config,
    name: config.name + "_legacy",
    module: {
      rules: [
        {
          use: {
            loader: "babel-loader",
            options: {
              targets: "Chrome >= 64, Firefox >= 65, Safari >= 14",
              presets: ["@babel/preset-env"]
            }
          }
        }
      ]
    },
  }
  legacy_config.output = {
    ...legacy_config.output,
    filename: config.output.filename.replace(".js", "-legacy.js"),
  }

  let es6_config = {
    ...config,
    name: config.name + "_es6",
    experiments: {outputModule: true},
    output: {
      filename: config.output.filename.replace(".js", ".mjs"),
      library: {
        type: "module"
      }
    }
  }

  let cjs_config = {
    ...config,
    name: config.name + "_cjs",
    target: "node",
    output: {
      filename: config.output.filename.replace(".js", ".cjs"),
      library: {
        type: "commonjs"
      }
    },
    externals: {
      "ws": "commonjs ws",
      "crypto": "commonjs crypto",
      "ipaddr.js": "commonjs ipaddr.js"
    },
    optimization: {
      minimize: false
    }
  }

  new_configs.push(legacy_config);
  new_configs.push(es6_config);
  new_configs.push(cjs_config);
}

module.exports = webpack_configs.concat(new_configs);;