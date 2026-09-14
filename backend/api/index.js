// Vercel serverless entry point.
//
// Only used for the staging deployment (see render.yaml for production,
// which runs src/index.js as a long-lived process instead). Vercel treats a
// default-exported Express app as a request handler directly, and the
// rewrite in vercel.json sends every path here so the app's own /api router
// sees the real incoming URL.

import { createApp } from "../src/app.js";

export default createApp();
