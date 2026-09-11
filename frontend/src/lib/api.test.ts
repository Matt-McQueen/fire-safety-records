import { afterEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn());
vi.mock("./http", () => ({ request }));

const {
  createResource,
  deactivateUser,
  createUser,
  fetchApiIndex,
  fetchCompliance,
  fetchFullAssessment,
  getResource,
  getUser,
  listAuditLog,
  listResource,
  listUsers,
  publishAssessment,
  removeResource,
  updateResource,
  updateUser,
} = await import("./api");

afterEach(() => {
  request.mockReset();
});

describe("the generic CRUD calls", () => {
  it("listResource issues a GET with the params as a query", async () => {
    request.mockResolvedValue({ data: [], page: {} });
    await listResource("/premises", { limit: 10, q: "glasgow" });
    expect(request).toHaveBeenCalledWith("GET", "/premises", undefined, {
      query: { limit: 10, q: "glasgow" },
    });
  });

  it("listResource defaults to an empty params object", async () => {
    request.mockResolvedValue({ data: [], page: {} });
    await listResource("/premises");
    expect(request).toHaveBeenCalledWith("GET", "/premises", undefined, { query: {} });
  });

  it("getResource issues a GET to the resource's own path", async () => {
    request.mockResolvedValue({ data: { id: 1 } });
    await getResource("/premises", 42);
    expect(request).toHaveBeenCalledWith("GET", "/premises/42");
  });

  it("createResource issues a POST with the body", async () => {
    request.mockResolvedValue({ data: { id: 1 } });
    await createResource("/premises", { name: "Test" });
    expect(request).toHaveBeenCalledWith("POST", "/premises", { name: "Test" });
  });

  it("updateResource issues a PATCH to the resource's own path with the body", async () => {
    request.mockResolvedValue({ data: { id: 1 } });
    await updateResource("/premises", 42, { name: "Renamed" });
    expect(request).toHaveBeenCalledWith("PATCH", "/premises/42", { name: "Renamed" });
  });

  it("removeResource issues a DELETE to the resource's own path", async () => {
    request.mockResolvedValue(undefined);
    await removeResource("/premises", 42);
    expect(request).toHaveBeenCalledWith("DELETE", "/premises/42");
  });
});

describe("discovery and premises extras", () => {
  it("fetchApiIndex reads the machine-readable index", async () => {
    request.mockResolvedValue({ data: { resources: [], extra: [] } });
    await fetchApiIndex();
    expect(request).toHaveBeenCalledWith("GET", "/");
  });

  it("fetchCompliance reads the compliance position for a premises", async () => {
    request.mockResolvedValue({ data: {} });
    await fetchCompliance(7);
    expect(request).toHaveBeenCalledWith("GET", "/premises/7/compliance");
  });
});

describe("fire risk assessment extras", () => {
  it("publishAssessment posts to the publish endpoint, defaulting to an empty body", async () => {
    request.mockResolvedValue({ data: { id: 1 } });
    await publishAssessment(9);
    expect(request).toHaveBeenCalledWith("POST", "/fire-risk-assessments/9/publish", {});
  });

  it("publishAssessment forwards the recorded_on and assessment_type given", async () => {
    request.mockResolvedValue({ data: { id: 1 } });
    await publishAssessment(9, { assessment_type: "review" });
    expect(request).toHaveBeenCalledWith("POST", "/fire-risk-assessments/9/publish", {
      assessment_type: "review",
    });
  });

  it("fetchFullAssessment reads the assembled view", async () => {
    request.mockResolvedValue({ data: {} });
    await fetchFullAssessment(9);
    expect(request).toHaveBeenCalledWith("GET", "/fire-risk-assessments/9/full");
  });
});

describe("user administration", () => {
  it("listUsers passes its filters through as a query", async () => {
    request.mockResolvedValue({ data: [], page: {} });
    await listUsers({ role: "manager", is_active: "true" });
    expect(request).toHaveBeenCalledWith("GET", "/users", undefined, {
      query: { role: "manager", is_active: "true" },
    });
  });

  it("getUser, createUser, updateUser and deactivateUser hit the expected paths", async () => {
    request.mockResolvedValue({ data: {} });

    await getUser(3);
    expect(request).toHaveBeenLastCalledWith("GET", "/users/3");

    await createUser({ email: "a@example.com" });
    expect(request).toHaveBeenLastCalledWith("POST", "/users", { email: "a@example.com" });

    await updateUser(3, { role: "viewer" });
    expect(request).toHaveBeenLastCalledWith("PATCH", "/users/3", { role: "viewer" });

    await deactivateUser(3);
    expect(request).toHaveBeenLastCalledWith("DELETE", "/users/3");
  });

  it("listAuditLog passes its filters through as a query", async () => {
    request.mockResolvedValue({ data: [], page: {} });
    await listAuditLog({ outcome: "denied", limit: 20 });
    expect(request).toHaveBeenCalledWith("GET", "/users/audit/log", undefined, {
      query: { outcome: "denied", limit: 20 },
    });
  });
});
