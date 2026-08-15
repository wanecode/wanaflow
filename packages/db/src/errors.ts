import type { ArtifactRevision } from "./types";

export class DatabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseConfigurationError";
  }
}

export class ResourceNotFoundError extends Error {
  constructor(public readonly resource: string) {
    super(`${resource} was not found.`);
    this.name = "ResourceNotFoundError";
  }
}

export class RevisionConflictError extends Error {
  constructor(public readonly currentRevision: ArtifactRevision) {
    super("The artifact draft changed after this editor loaded it.");
    this.name = "RevisionConflictError";
  }
}

export class DuplicateResourceError extends Error {
  constructor(public readonly field: string) {
    super(`A resource with this ${field} already exists.`);
    this.name = "DuplicateResourceError";
  }
}

export class MembershipRequiredError extends Error {
  constructor() {
    super("This account does not belong to a Wanaflow organization.");
    this.name = "MembershipRequiredError";
  }
}

export class OrganizationContextRequiredError extends Error {
  constructor() {
    super("Select an organization before making this request.");
    this.name = "OrganizationContextRequiredError";
  }
}

export class PermissionDeniedError extends Error {
  constructor(public readonly permission: string) {
    super("You do not have permission to perform this action.");
    this.name = "PermissionDeniedError";
  }
}

export class BootstrapUnavailableError extends Error {
  constructor(message = "The first-owner bootstrap has already been completed.") {
    super(message);
    this.name = "BootstrapUnavailableError";
  }
}

export class ReviewPolicyError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ReviewPolicyError";
  }
}

export class ReviewStateConflictError extends Error {
  constructor(public readonly status: string) {
    super(`This review is already ${status.toLowerCase().replaceAll("_", " ")}.`);
    this.name = "ReviewStateConflictError";
  }
}

export class PublicationPolicyError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PublicationPolicyError";
  }
}

export class RuntimePolicyError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RuntimePolicyError";
  }
}

export class RuntimeStateConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeStateConflictError";
  }
}
