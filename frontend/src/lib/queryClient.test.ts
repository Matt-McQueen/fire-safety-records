import { describe, expect, it } from "vitest";
import { queryClient } from "./queryClient";
import { ApiError } from "./http";

describe("queryClient's default retry policy", () => {
  const retry = queryClient.getDefaultOptions().queries?.retry as (
    failureCount: number,
    error: unknown,
  ) => boolean;

  it("never retries a 4xx ApiError", () => {
    const error = new ApiError(404, { code: "not_found", message: "Record not found" });
    expect(retry(0, error)).toBe(false);
    expect(retry(1, error)).toBe(false);
  });

  it("retries a 5xx ApiError up to twice", () => {
    const error = new ApiError(500, { code: "internal_error", message: "Something broke" });
    expect(retry(0, error)).toBe(true);
    expect(retry(1, error)).toBe(true);
    expect(retry(2, error)).toBe(false);
  });

  it("retries a plain network error (not an ApiError) up to twice", () => {
    const error = new Error("network down");
    expect(retry(0, error)).toBe(true);
    expect(retry(1, error)).toBe(true);
    expect(retry(2, error)).toBe(false);
  });
});

describe("queryClient's mutation defaults", () => {
  it("never retries a mutation", () => {
    expect(queryClient.getDefaultOptions().mutations?.retry).toBe(false);
  });
});
