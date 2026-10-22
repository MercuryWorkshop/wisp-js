const ts_loader = {
  loader: "ts-loader",
  options: {
    compilerOptions: {
      noEmit: false
    }
  }
}

const babel_loader = {
  loader: "babel-loader",
  options: {
    targets: "Chrome >= 64, Firefox >= 65, Safari >= 14",
    presets: ["@babel/preset-env"]
  }
}

const common_options = {
  mode: "development",
  stats: {
    orphanModules: true,
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: ts_loader,
        exclude: /node_modules/,
      },
      {
        //allow extensionless imports from .mjs files, which webpack treats as strict esm
        test: /\.m?js$/,
        resolve: {fullySpecified: false},
      },
    ],
  },
  resolve: {
    extensions: [".tsx", ".ts", ".js"],
  },
  devtool: "source-map",
  optimization: {mangleExports: false}
}

const webpack_configs = [
  {
    name: "client",
    entry: "./src/entrypoints/client.ts",
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
    entry: "./src/entrypoints/server.ts",
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
    entry: "./src/entrypoints/full.ts",
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
          test: /\.tsx?$/,
          use: [babel_loader, ts_loader],
          exclude: /node_modules/,
        },
        {
          test: /\.m?js$/,
          use: babel_loader,
          resolve: {fullySpecified: false},
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