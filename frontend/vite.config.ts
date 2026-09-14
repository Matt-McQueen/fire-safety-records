import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Stamps the built index.html with the commit it came from, as
// <meta name="app-commit">. The API reports its own commit from /api/health
// (see backend/src/config/env.js for why); this is the same thing for the
// frontend, which has no endpoint to ask. Without it there is no way to tell
// whether a Pages deploy has finished, and a test suite that starts too early
// silently tests the build it was meant to replace.
//
// Cloudflare Pages sets CF_PAGES_COMMIT_SHA during the build. VITE_COMMIT is
// the manual override for anywhere else; empty locally, which is correct — a
// dev server is not a deployment of anything.
// Declared rather than pulled in with @types/node: this is the only Node API
// the frontend's build config touches, and it is not worth a dependency.
declare const process: { env: Record<string, string | undefined> };

function commitStamp(): Plugin {
  const commit = process.env.CF_PAGES_COMMIT_SHA || process.env.VITE_COMMIT || "";
  return {
    name: "commit-stamp",
    transformIndexHtml(html) {
      return html.replace(
        "</head>",
        `  <meta name="app-commit" content="${commit}" />\n  </head>`,
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), commitStamp()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
