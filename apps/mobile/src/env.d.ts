// Build-time public configuration, inlined into the bundle by babel-plugin-transform-inline-environment-variables
// (see babel.config.js). Never put secrets in GOCRYPTO_* variables: they ship inside the app.
declare namespace NodeJS {
  interface ProcessEnv {
    readonly GOCRYPTO_API_URL?: string;
    readonly GOCRYPTO_WS_URL?: string;
    readonly GOCRYPTO_WS_PATH?: string;
    readonly GOCRYPTO_SANDBOX?: string;
  }
}

// Metro replaces `process.env.GOCRYPTO_*` at build time; there is no Node `process` at runtime.
declare const process: { readonly env: NodeJS.ProcessEnv };
