/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Set only in the Cloudflare Pages Preview environment (the staging branch),
  // so a build can tell staging and production apart at a glance. Unset in
  // Production, where it should stay absent rather than "production" - a
  // missing value is one less thing to keep in sync with reality.
  readonly VITE_ENVIRONMENT?: "staging";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
