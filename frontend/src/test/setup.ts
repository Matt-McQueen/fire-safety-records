import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Testing Library's auto-cleanup normally hooks itself into a global
// afterEach; with globals disabled here (see vitest.config.ts) it has
// nothing to hook into, so each rendered component would otherwise leak
// into the next test's DOM.
afterEach(() => {
  cleanup();
});
