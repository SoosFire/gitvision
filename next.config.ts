import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Allow github avatar images via next/image (we use unoptimized for now, but this is safe too).
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
    ],
  },
  // web-tree-sitter dynamically loads its own WASM via createRequire and
  // fs.readFile. Don't let Next bundle these — they need to be resolved at
  // runtime against the deployed node_modules.
  serverExternalPackages: ["web-tree-sitter", "@vscode/tree-sitter-wasm"],
  // Make sure the WASM binaries actually land in the production trace. Without
  // these, Railway's serverless trace would skip the .wasm files in node_modules
  // and the route would fail at runtime with "ENOENT". The route key matches
  // the App-Router path of the debug endpoint.
  outputFileTracingIncludes: {
    "/api/debug/code-analysis": [
      "node_modules/web-tree-sitter/web-tree-sitter.wasm",
      "node_modules/@vscode/tree-sitter-wasm/wasm/*.wasm",
    ],
  },
};

export default nextConfig;
