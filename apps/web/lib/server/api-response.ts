import { randomUUID } from "node:crypto";

import {
  DatabaseConfigurationError,
  DuplicateResourceError,
  MembershipRequiredError,
  OrganizationContextRequiredError,
  PermissionDeniedError,
  PublicationPolicyError,
  ResourceNotFoundError,
  RevisionConflictError,
  ReviewPolicyError,
  ReviewStateConflictError,
  RuntimePolicyError,
  RuntimeStateConflictError,
} from "@wanaflow/db";
import { BpmnSourceError } from "@wanaflow/modeling";
import { RuntimeProfileError } from "@wanaflow/runtime";
import { ZodError } from "zod";

import { AuthenticationRequiredError } from "./authenticated-context";

export function apiJson(body: unknown, init: ResponseInit = {}) {
  const requestId = randomUUID();
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  headers.set("X-Request-Id", requestId);
  if (!headers.has("X-Wanaflow-Auth-Mode")) headers.set("X-Wanaflow-Auth-Mode", "session-cookie");
  return new Response(JSON.stringify(body), { ...init, headers });
}

function isDatabaseUnavailable(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return new Set(["ECONNREFUSED", "3D000", "42P01", "57P03"]).has(String(error.code));
}

export function apiError(error: unknown) {
  if (error instanceof ZodError) {
    return apiJson(
      {
        error: {
          code: "INVALID_REQUEST",
          message: "The request body is invalid.",
          issues: error.issues,
        },
      },
      { status: 400 },
    );
  }
  if (error instanceof BpmnSourceError) {
    return apiJson(
      { error: { code: error.code, message: error.message, issues: error.issues } },
      { status: 422 },
    );
  }
  if (error instanceof RuntimeProfileError) {
    return apiJson(
      { error: { code: error.code, message: error.message, elementId: error.elementId } },
      { status: 422 },
    );
  }
  if (error instanceof RevisionConflictError) {
    return apiJson(
      {
        error: {
          code: "REVISION_CONFLICT",
          message: error.message,
          currentRevision: error.currentRevision,
        },
      },
      { status: 409 },
    );
  }
  if (error instanceof ReviewPolicyError) {
    return apiJson(
      { error: { code: error.code, message: error.message } },
      { status: 409 },
    );
  }
  if (error instanceof PublicationPolicyError) {
    return apiJson(
      { error: { code: error.code, message: error.message } },
      { status: 409 },
    );
  }
  if (error instanceof RuntimePolicyError || error instanceof RuntimeStateConflictError) {
    return apiJson(
      {
        error: {
          code: error instanceof RuntimePolicyError ? error.code : "RUNTIME_STATE_CONFLICT",
          message: error.message,
        },
      },
      { status: 409 },
    );
  }
  if (error instanceof ReviewStateConflictError) {
    return apiJson(
      { error: { code: "REVIEW_STATE_CONFLICT", message: error.message, status: error.status } },
      { status: 409 },
    );
  }
  if (error instanceof AuthenticationRequiredError) {
    return apiJson(
      { error: { code: "AUTHENTICATION_REQUIRED", message: error.message } },
      { status: 401 },
    );
  }
  if (error instanceof MembershipRequiredError || error instanceof PermissionDeniedError) {
    return apiJson(
      { error: { code: "PERMISSION_DENIED", message: error.message } },
      { status: 403 },
    );
  }
  if (error instanceof OrganizationContextRequiredError) {
    return apiJson(
      { error: { code: "ORGANIZATION_CONTEXT_REQUIRED", message: error.message } },
      { status: 400 },
    );
  }
  if (error instanceof DuplicateResourceError) {
    return apiJson(
      { error: { code: "RESOURCE_KEY_CONFLICT", message: error.message, field: error.field } },
      { status: 409 },
    );
  }
  if (error instanceof ResourceNotFoundError) {
    return apiJson(
      { error: { code: "RESOURCE_NOT_FOUND", message: error.message } },
      { status: 404 },
    );
  }
  if (error instanceof DatabaseConfigurationError || isDatabaseUnavailable(error)) {
    return apiJson(
      {
        error: {
          code: "DATABASE_UNAVAILABLE",
          message: "PostgreSQL is unavailable or not migrated. Run `pnpm dev:setup`.",
        },
      },
      { status: 503 },
    );
  }

  console.error(error);
  return apiJson(
    { error: { code: "INTERNAL_ERROR", message: "An unexpected server error occurred." } },
    { status: 500 },
  );
}

export async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new ZodError([
      {
        code: "custom",
        path: [],
        message: "The request body must be valid JSON.",
      },
    ]);
  }
}

export function readIfMatch(request: Request) {
  const value = request.headers.get("If-Match");
  const match = value?.match(/^(?:W\/)?"([0-9a-f-]{36})"$/i);
  if (!match) {
    throw new ZodError([
      {
        code: "custom",
        path: ["If-Match"],
        message: 'If-Match must contain the quoted base revision UUID, for example "revision-id".',
      },
    ]);
  }
  return match[1];
}
