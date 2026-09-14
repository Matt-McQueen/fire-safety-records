// The API surface, assembled in one place.
//
// Everything below `authenticate` requires a valid access token, so a resource
// added to the list cannot be published unauthenticated by omission. The only
// endpoints outside it are /api/health and /api/auth/login and /refresh.

import { Router } from "express";
import { config } from "../config/env.js";
import { authenticate, requireRole } from "../auth/middleware.js";
import { authRouter } from "../auth/authRoutes.js";
import { usersRouter } from "./users.js";
import { resourceRouter } from "../domain/resource.js";
import { asyncHandler } from "../http/asyncHandler.js";
import { complianceSummaryForAccessiblePremises } from "../domain/compliance.js";

import {
  legalBasis,
  people,
  premises,
  safetyRoles,
  schedule2Measures,
} from "../domain/resources/premises.js";
import {
  arrangements,
  dangerousSubstances,
  fireRiskAssessments,
  fraMeasures,
  personsAtRisk,
  significantFindings,
} from "../domain/resources/assessments.js";
import {
  checkSchedules,
  equipment,
  equipmentChecks,
  escapeRouteChecks,
  escapeRoutes,
} from "../domain/resources/equipment.js";
import {
  cooperationRecords,
  emergencyProcedures,
  fireDrills,
  healthSafetyPolicies,
  informationRecords,
  trainingRecords,
} from "../domain/resources/procedures.js";
import {
  enforcementNotices,
  enforcementVisits,
  incidents,
} from "../domain/resources/incidents.js";

// Every table in the schema is represented. Adding one here is what publishes
// it; there is no other route to the database.
const RESOURCES = [
  premises,
  people,
  safetyRoles,
  fireRiskAssessments,
  significantFindings,
  fraMeasures,
  personsAtRisk,
  arrangements,
  dangerousSubstances,
  checkSchedules,
  equipment,
  equipmentChecks,
  escapeRoutes,
  escapeRouteChecks,
  emergencyProcedures,
  fireDrills,
  trainingRecords,
  informationRecords,
  cooperationRecords,
  healthSafetyPolicies,
  incidents,
  enforcementNotices,
  enforcementVisits,
  legalBasis,
  schedule2Measures,
];

export function buildApiRouter() {
  const api = Router();

  // Reports which build is answering, not just that something is. `commit` is
  // what a deployment check waits on: a push takes a minute or two to reach
  // Render, Vercel and Pages, and until it has, this endpoint is the only way
  // to tell the new build from the one it replaced. Null where the platform
  // does not inject a commit (a local process, most of the time).
  api.get("/health", (req, res) => {
    res.json({
      status: "ok",
      service: "fire-safety-records-api",
      environment: config.environment,
      commit: config.commit,
    });
  });

  api.use("/auth", authRouter);

  // From here down, an access token is required. One call, in front of
  // everything, rather than a decision repeated at each route.
  api.use(authenticate);

  api.use("/users", usersRouter);

  // Registered ahead of the premises resource router below so it isn't
  // swallowed by that router's own GET /:id route - see
  // complianceSummaryForAccessiblePremises for why this exists as its own
  // endpoint rather than another per-premises call.
  api.get(
    "/premises/compliance-summary",
    requireRole("viewer"),
    asyncHandler(async (req, res) => {
      res.json({ data: await complianceSummaryForAccessiblePremises(req.user) });
    }),
  );

  for (const resource of RESOURCES) {
    api.use(resource.path, resourceRouter(resource));
  }

  // A machine-readable index of what is served, so a client can discover the
  // endpoints and the roles they need without reading the source.
  api.get("/", (req, res) => {
    res.json({
      data: {
        resources: RESOURCES.map(describeResource),
        extra: [
          { path: "/api/premises/:id/compliance", description: "Computed compliance position" },
          {
            path: "/api/premises/compliance-summary",
            description: "Compliance summary for every premises the caller can reach",
          },
          {
            path: "/api/fire-risk-assessments/:id/full",
            description: "Assessment with findings, measures and persons at risk",
          },
          {
            path: "/api/fire-risk-assessments/:id/publish",
            description: "Make a draft the recorded assessment",
          },
          { path: "/api/users/audit/log", description: "Audit trail (admin)" },
        ],
      },
    });
  });

  return api;
}

function describeResource(resource) {
  return {
    path: `/api${resource.path}`,
    name: resource.name,
    operations: resource.operations ?? ["list", "get", "create", "update", "remove"],
    permissions: resource.permissions ?? {
      read: "viewer",
      create: "assessor",
      update: "assessor",
      remove: "manager",
    },
    filters: (resource.filters ?? []).map((filter) => filter.param),
    sortable: Object.keys(resource.sortable ?? { id: "t.id" }),
  };
}
