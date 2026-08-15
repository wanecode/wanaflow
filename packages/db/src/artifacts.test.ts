import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  assertPermission,
  addReviewComment,
  createPublication,
  createReview,
  deployPublication,
  decideReview,
  closePool,
  ensureLocalSetup,
  getArtifact,
  getOrganizationLibrary,
  getPool,
  getPublication,
  getReview,
  listProjectEnvironments,
  resolvePrincipalContext,
  resolveReviewComment,
  rolePermissions,
  saveArtifactRevision,
  listArtifactPresence,
  touchArtifactPresence,
  exportProjectPackage,
  importProjectPackage,
  createAiExperience,
  getAiExperience,
  linkAiExperienceArtifact,
  recordAiChoiceResponse,
  updateAiExperienceTranscript,
} from "./index";
import type { PrincipalContext } from "./types";
import { runMigrations } from "./migrate";

function processSource(name: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs" targetNamespace="https://wanaflow.dev/test">
  <bpmn:process id="test-process" name="${name}" isExecutable="true">
    <bpmn:startEvent id="start"><bpmn:outgoing>flow</bpmn:outgoing></bpmn:startEvent>
    <bpmn:endEvent id="end"><bpmn:incoming>flow</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="flow" sourceRef="start" targetRef="end" />
  </bpmn:process>
</bpmn:definitions>`;
}

describe("artifact registry", () => {
  beforeAll(async () => {
    await runMigrations();
  });

  beforeEach(async () => {
    await getPool().query(`
      TRUNCATE deployments, artifact_versions, publications, environments,
        review_decisions, review_comments, review_assignments, reviews,
        outbox_events, audit_records, artifact_revisions, artifacts,
        organization_memberships, projects, principals, workspaces, organizations,
        "session", "account", "verification", "user" CASCADE
    `);
  });

  afterAll(async () => {
    await getPool().query(`
      TRUNCATE deployments, artifact_versions, publications, environments,
        review_decisions, review_comments, review_assignments, reviews,
        outbox_events, audit_records, artifact_revisions, artifacts,
        organization_memberships, projects, principals, workspaces, organizations,
        "session", "account", "verification", "user" CASCADE
    `);
    await closePool();
  });

  it("bootstraps one immutable BPMN revision idempotently", async () => {
    const first = await ensureLocalSetup({
      organizationKey: "local",
      workspaceKey: "default",
      projectKey: "people-operations",
      artifactSource: processSource("Original"),
    });
    const second = await ensureLocalSetup({
      organizationKey: "local",
      workspaceKey: "default",
      projectKey: "people-operations",
      artifactSource: processSource("Ignored after setup"),
    });

    expect(second.artifact.id).toBe(first.artifact.id);
    expect(second.artifact.revision.id).toBe(first.artifact.revision.id);
    expect(second.artifact.revision.number).toBe(1);
    expect(second.artifact.revision.source).toContain('name="Original"');
  });

  it("persists an AI experience with its transcript, choices, and ordinary artifacts", async () => {
    const setup = await ensureLocalSetup({
      organizationKey: "local",
      workspaceKey: "default",
      projectKey: "people-operations",
      artifactSource: processSource("Supplier onboarding"),
    });
    const context: PrincipalContext = {
      organization: setup.organization,
      principal: setup.principal,
      role: "organization-owner",
      workspaceScopeId: null,
      permissions: rolePermissions["organization-owner"],
    };
    const experience = await createAiExperience(context, {
      projectId: setup.project.id,
      title: "Supplier onboarding",
      description: "Collect the request, review risk, and share the result.",
    });
    await linkAiExperienceArtifact(context, experience.id, setup.artifact.id, "MAIN");
    await updateAiExperienceTranscript(context, experience.id, [
      { id: "message-1", role: "user", content: "Start with finance review." },
    ]);
    await recordAiChoiceResponse(context, experience.id, {
      toolCallId: "choice-1",
      question: "Who owns the first review",
      selection: "SINGLE",
      options: [
        { id: "finance", label: "Finance" },
        { id: "procurement", label: "Procurement" },
      ],
      answer: ["finance"],
    });

    const stored = await getAiExperience(context, experience.id);
    expect(stored).toMatchObject({
      title: "Supplier onboarding",
      transcript: [{ id: "message-1", role: "user", content: "Start with finance review." }],
      artifacts: [{ role: "MAIN", artifact: { id: setup.artifact.id } }],
    });
    expect(stored.events.map((event) => event.kind)).toEqual(["SESSION_CREATED", "CHOICE_ANSWERED"]);
  });

  it("exports and atomically imports an integrity-checked project package", async () => {
    const setup = await ensureLocalSetup({
      organizationKey: "local",
      workspaceKey: "default",
      projectKey: "people-operations",
      artifactSource: processSource("Portable process"),
    });
    const context: PrincipalContext = {
      organization: setup.organization,
      principal: setup.principal,
      role: "organization-owner",
      workspaceScopeId: null,
      permissions: rolePermissions["organization-owner"],
    };
    const projectPackage = await exportProjectPackage(context, setup.project.id);
    expect(projectPackage.artifacts).toEqual([
      expect.objectContaining({ key: setup.artifact.key, contentSha256: setup.artifact.revision.contentSha256 }),
    ]);

    const workspace = await getPool().query<{ id: string }>(
      `INSERT INTO workspaces (organization_id, key, name)
       VALUES ($1, 'portable', 'Portable') RETURNING id`,
      [setup.organization.id],
    );
    const imported = await importProjectPackage(context, workspace.rows[0].id, projectPackage);
    const importedArtifacts = await getPool().query<{ count: string }>(
      "SELECT count(*) FROM artifacts WHERE project_id = $1",
      [imported.id],
    );
    expect(importedArtifacts.rows[0].count).toBe("1");

    const tampered = structuredClone(projectPackage);
    tampered.project.key = "tampered-project";
    tampered.artifacts[0].source += "<!-- changed -->";
    await expect(importProjectPackage(context, workspace.rows[0].id, tampered))
      .rejects.toMatchObject({ code: "PROJECT_PACKAGE_INTEGRITY" });
  });

  it("saves a new revision and makes it the draft head", async () => {
    const setup = await ensureLocalSetup({
      organizationKey: "local",
      workspaceKey: "default",
      projectKey: "people-operations",
      artifactSource: processSource("Original"),
    });
    const saved = await saveArtifactRevision({
      organizationId: setup.organization.id,
      artifactId: setup.artifact.id,
      principalId: setup.principal.id,
      baseRevisionId: setup.artifact.revision.id,
      source: processSource("Changed"),
    });

    expect(saved.created).toBe(true);
    expect(saved.artifact.revision.number).toBe(2);
    expect((await getArtifact(setup.organization.id, setup.artifact.id)).revision.source).toContain(
      'name="Changed"',
    );
  });

  it("rejects a stale base revision without losing the current draft", async () => {
    const setup = await ensureLocalSetup({
      organizationKey: "local",
      workspaceKey: "default",
      projectKey: "people-operations",
      artifactSource: processSource("Original"),
    });
    const current = await saveArtifactRevision({
      organizationId: setup.organization.id,
      artifactId: setup.artifact.id,
      principalId: setup.principal.id,
      baseRevisionId: setup.artifact.revision.id,
      source: processSource("Current edit"),
    });

    await expect(
      saveArtifactRevision({
        organizationId: setup.organization.id,
        artifactId: setup.artifact.id,
        principalId: setup.principal.id,
        baseRevisionId: setup.artifact.revision.id,
        source: processSource("Conflicting edit"),
      }),
    ).rejects.toMatchObject({
      name: "RevisionConflictError",
      currentRevision: expect.objectContaining({ id: current.artifact.revision.id }),
    });
  });

  it("serializes concurrent editors so only one revision becomes the head", async () => {
    const setup = await ensureLocalSetup({
      organizationKey: "local",
      workspaceKey: "default",
      projectKey: "people-operations",
      artifactSource: processSource("Original"),
    });
    const save = (name: string) =>
      saveArtifactRevision({
        organizationId: setup.organization.id,
        artifactId: setup.artifact.id,
        principalId: setup.principal.id,
        baseRevisionId: setup.artifact.revision.id,
        source: processSource(name),
      });

    const results = await Promise.allSettled([save("Editor A"), save("Editor B")]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      reason: { name: "RevisionConflictError" },
    });
    expect((await getArtifact(setup.organization.id, setup.artifact.id)).revision.number).toBe(2);

    const revisionCount = await getPool().query<{ count: string }>(
      "SELECT count(*) FROM artifact_revisions WHERE artifact_id = $1",
      [setup.artifact.id],
    );
    expect(revisionCount.rows[0].count).toBe("2");
  });

  it("shares live element presence while keeping each editor revision-aware", async () => {
    const setup = await ensureLocalSetup({
      organizationKey: "local",
      workspaceKey: "default",
      projectKey: "people-operations",
      artifactSource: processSource("Collaborative draft"),
    });
    const context: PrincipalContext = {
      organization: setup.organization,
      principal: setup.principal,
      role: "organization-owner",
      workspaceScopeId: null,
      permissions: rolePermissions["organization-owner"],
    };
    await touchArtifactPresence(context, {
      artifactId: setup.artifact.id,
      revisionId: setup.artifact.revision.id,
      clientId: "studio_editor_one",
      selectedElementId: "start",
      cursor: { x: 0.35, y: 0.62 },
    });
    const initial = await listArtifactPresence(context, setup.artifact.id);
    expect(initial[0]).toMatchObject({
      clientId: "studio_editor_one",
      currentRevisionId: setup.artifact.revision.id,
      isCurrentRevision: true,
      selectedElement: { id: "start" },
      cursor: { x: 0.35, y: 0.62 },
    });

    await saveArtifactRevision({
      organizationId: setup.organization.id,
      artifactId: setup.artifact.id,
      principalId: setup.principal.id,
      baseRevisionId: setup.artifact.revision.id,
      source: processSource("Newer collaborative draft"),
    });
    expect((await listArtifactPresence(context, setup.artifact.id))[0].isCurrentRevision).toBe(false);
  });

  it("enforces revision immutability in PostgreSQL", async () => {
    const setup = await ensureLocalSetup({
      organizationKey: "local",
      workspaceKey: "default",
      projectKey: "people-operations",
      artifactSource: processSource("Original"),
    });

    await expect(
      getPool().query("UPDATE artifact_revisions SET source = source WHERE id = $1", [
        setup.artifact.revision.id,
      ]),
    ).rejects.toThrow("artifact revisions are immutable");
  });

  it("denies permissions that are not assigned to a role", () => {
    const context = {
      organization: { id: crypto.randomUUID(), key: "review", name: "Review" },
      principal: {
        id: crypto.randomUUID(),
        organizationId: crypto.randomUUID(),
        email: "reviewer@example.com",
        displayName: "Reviewer",
      },
      role: "reviewer",
      workspaceScopeId: null,
      permissions: ["project:read", "artifact:read"],
    } satisfies PrincipalContext;

    expect(() => assertPermission(context, "artifact:update")).toThrow(
      "You do not have permission",
    );
  });

  it("resolves membership context without exposing another organization", async () => {
    const user = await getPool().query<{ id: string }>(
      `INSERT INTO "user" (name, email, "emailVerified")
       VALUES ('Awa', 'awa@example.com', true)
       RETURNING id`,
    );
    const setup = await ensureLocalSetup({
      organizationKey: "local",
      workspaceKey: "default",
      projectKey: "people-operations",
      artifactSource: processSource("Original"),
    });
    await getPool().query("UPDATE principals SET auth_user_id = $1 WHERE id = $2", [
      user.rows[0].id,
      setup.principal.id,
    ]);
    await getPool().query(
      `INSERT INTO organization_memberships (organization_id, principal_id, role)
       VALUES ($1, $2, 'designer')`,
      [setup.organization.id, setup.principal.id],
    );

    const context = await resolvePrincipalContext(user.rows[0].id);
    expect(context).toMatchObject({ role: "designer", organization: { id: setup.organization.id } });
    const library = await getOrganizationLibrary(context);
    expect(library.workspaces[0].projects[0].artifacts[0].id).toBe(setup.artifact.id);
    await expect(
      resolvePrincipalContext(user.rows[0].id, crypto.randomUUID()),
    ).rejects.toMatchObject({ name: "ResourceNotFoundError", resource: "organization" });
  });

  it("rejects malformed XML before opening a transaction", async () => {
    const setup = await ensureLocalSetup({
      organizationKey: "local",
      workspaceKey: "default",
      projectKey: "people-operations",
      artifactSource: processSource("Original"),
    });
    await expect(
      saveArtifactRevision({
        organizationId: setup.organization.id,
        artifactId: setup.artifact.id,
        principalId: setup.principal.id,
        baseRevisionId: setup.artifact.revision.id,
        source: "<not-bpmn />",
      }),
    ).rejects.toMatchObject({ code: "INVALID_BPMN_XML" });
  });

  async function reviewFixture() {
    const setup = await ensureLocalSetup({
      organizationKey: "local",
      workspaceKey: "default",
      projectKey: "people-operations",
      artifactSource: processSource("Review subject"),
    });
    await getPool().query(
      `INSERT INTO organization_memberships (organization_id, principal_id, role)
       VALUES ($1, $2, 'designer')`,
      [setup.organization.id, setup.principal.id],
    );
    const reviewer = await getPool().query<{
      id: string;
      email: string;
      display_name: string;
    }>(
      `INSERT INTO principals (organization_id, email, display_name)
       VALUES ($1, 'reviewer@example.com', 'Independent Reviewer')
       RETURNING id, email, display_name`,
      [setup.organization.id],
    );
    await getPool().query(
      `INSERT INTO organization_memberships (organization_id, principal_id, role)
       VALUES ($1, $2, 'reviewer')`,
      [setup.organization.id, reviewer.rows[0].id],
    );
    const requesterContext: PrincipalContext = {
      organization: setup.organization,
      principal: setup.principal,
      role: "designer",
      workspaceScopeId: null,
      permissions: rolePermissions.designer,
    };
    const reviewerContext: PrincipalContext = {
      organization: setup.organization,
      principal: {
        id: reviewer.rows[0].id,
        organizationId: setup.organization.id,
        email: reviewer.rows[0].email,
        displayName: reviewer.rows[0].display_name,
      },
      role: "reviewer",
      workspaceScopeId: null,
      permissions: rolePermissions.reviewer,
    };
    const review = await createReview(requesterContext, {
      artifactId: setup.artifact.id,
      revisionId: setup.artifact.revision.id,
      reviewerIds: [reviewerContext.principal.id],
      summary: "Check the exact handoff.",
    });
    return { setup, requesterContext, reviewerContext, review };
  }

  it("pins approval to an immutable revision while later edits create a separate draft", async () => {
    const { setup, requesterContext, reviewerContext, review } = await reviewFixture();
    const changed = await saveArtifactRevision({
      organizationId: setup.organization.id,
      artifactId: setup.artifact.id,
      principalId: setup.principal.id,
      baseRevisionId: setup.artifact.revision.id,
      source: processSource("A later draft"),
    });
    const approved = await decideReview(reviewerContext, review.id, { outcome: "APPROVED" });

    expect(approved.status).toBe("APPROVED");
    expect(approved.publicationEligible).toBe(true);
    expect(approved.revision.id).toBe(setup.artifact.revision.id);
    expect(changed.artifact.revision.id).not.toBe(approved.revision.id);
    expect((await getReview(requesterContext, review.id)).revision.source).toContain("Review subject");
    await expect(
      getPool().query("UPDATE artifact_revisions SET source = source WHERE id = $1", [
        approved.revision.id,
      ]),
    ).rejects.toThrow("artifact revisions are immutable");
  });

  it("summarizes the pinned revision against its immediate predecessor", async () => {
    const { setup, requesterContext, reviewerContext } = await reviewFixture();
    const changed = await saveArtifactRevision({
      organizationId: setup.organization.id,
      artifactId: setup.artifact.id,
      principalId: setup.principal.id,
      baseRevisionId: setup.artifact.revision.id,
      source: processSource("Changed review subject"),
    });
    const review = await createReview(requesterContext, {
      artifactId: setup.artifact.id,
      revisionId: changed.artifact.revision.id,
      reviewerIds: [reviewerContext.principal.id],
      summary: "Compare this saved revision.",
    });
    expect(review.changes).toMatchObject({
      previousRevisionNumber: 1,
      sourceChanged: true,
      addedElements: [],
      removedElements: [],
    });
  });

  it("anchors comments to BPMN element IDs and blocks approval until resolution", async () => {
    const { requesterContext, reviewerContext, review } = await reviewFixture();
    await expect(
      addReviewComment(reviewerContext, review.id, {
        elementId: "missing",
        body: "This cannot float outside the model.",
      }),
    ).rejects.toMatchObject({ name: "ReviewPolicyError", code: "ELEMENT_NOT_IN_REVISION" });

    const commented = await addReviewComment(reviewerContext, review.id, {
      elementId: "start",
      body: "Clarify how this process begins.",
      mentionedPrincipalIds: [requesterContext.principal.id],
    });
    expect(commented.comments[0]).toMatchObject({ elementId: "start", elementName: "start" });
    expect(commented.comments[0].mentions).toEqual([
      expect.objectContaining({ id: requesterContext.principal.id }),
    ]);
    await expect(
      decideReview(reviewerContext, review.id, { outcome: "APPROVED" }),
    ).rejects.toMatchObject({ code: "OPEN_COMMENTS" });

    const resolved = await resolveReviewComment(
      reviewerContext,
      review.id,
      commented.comments[0].id,
    );
    expect(resolved.comments[0].resolvedAt).not.toBeNull();
    await expect(
      decideReview(reviewerContext, review.id, { outcome: "APPROVED" }),
    ).resolves.toMatchObject({ status: "APPROVED", publicationEligible: true });
  });

  it("enforces reviewer assignment and separation of duty", async () => {
    const { setup, requesterContext, reviewerContext, review } = await reviewFixture();
    await expect(
      createReview(requesterContext, {
        artifactId: setup.artifact.id,
        revisionId: setup.artifact.revision.id,
        reviewerIds: [setup.principal.id],
        summary: "Self review",
      }),
    ).rejects.toMatchObject({ code: "SEPARATION_OF_DUTY" });

    const unassigned = await getPool().query<{
      id: string;
      email: string;
      display_name: string;
    }>(
      `INSERT INTO principals (organization_id, email, display_name)
       VALUES ($1, 'second@example.com', 'Second Reviewer')
       RETURNING id, email, display_name`,
      [setup.organization.id],
    );
    const unassignedContext: PrincipalContext = {
      ...reviewerContext,
      principal: {
        id: unassigned.rows[0].id,
        organizationId: setup.organization.id,
        email: unassigned.rows[0].email,
        displayName: unassigned.rows[0].display_name,
      },
    };
    await getPool().query(
      `INSERT INTO organization_memberships (organization_id, principal_id, role)
       VALUES ($1, $2, 'reviewer')`,
      [setup.organization.id, unassigned.rows[0].id],
    );
    await expect(
      decideReview(unassignedContext, review.id, { outcome: "APPROVED" }),
    ).rejects.toMatchObject({ name: "ResourceNotFoundError", resource: "review" });
  });

  it("serializes competing decisions and makes the terminal decision immutable", async () => {
    const { requesterContext, reviewerContext, review } = await reviewFixture();
    const decisions = await Promise.allSettled([
      decideReview(reviewerContext, review.id, { outcome: "APPROVED" }),
      decideReview(reviewerContext, review.id, {
        outcome: "CHANGES_REQUESTED",
        note: "Rework the handoff.",
      }),
    ]);
    expect(decisions.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(decisions.filter((result) => result.status === "rejected")).toHaveLength(1);
    const final = await getReview(reviewerContext, review.id);
    expect(["APPROVED", "CHANGES_REQUESTED"]).toContain(final.status);
    await expect(
      decideReview(reviewerContext, review.id, {
        outcome: "CHANGES_REQUESTED",
        note: "Try again.",
      }),
    ).rejects.toMatchObject({ name: "ReviewStateConflictError" });
    await expect(
      getPool().query("UPDATE reviews SET revision_id = $1 WHERE id = $2", [
        crypto.randomUUID(),
        review.id,
      ]),
    ).rejects.toThrow("review identity and pinned revision are immutable");
    await expect(
      createReview(requesterContext, {
        artifactId: review.artifact.id,
        revisionId: review.revision.id,
        reviewerIds: [reviewerContext.principal.id],
        summary: "Try to bypass the terminal result.",
      }),
    ).rejects.toMatchObject({ code: "REVIEW_ALREADY_EXISTS" });
  });

  it("publishes an approved revision once as an immutable artifact version", async () => {
    const { setup, requesterContext, reviewerContext, review } = await reviewFixture();
    await expect(
      createPublication(requesterContext, review.id),
    ).rejects.toMatchObject({ code: "PUBLICATION_NOT_ELIGIBLE" });

    await decideReview(reviewerContext, review.id, {
      outcome: "APPROVED",
      note: "Ready for a controlled release.",
    });
    const [first, repeated] = await Promise.all([
      createPublication(requesterContext, review.id),
      createPublication(requesterContext, review.id),
    ]);

    expect(repeated.id).toBe(first.id);
    expect(first.artifactVersion).toBe(1);
    expect(first.manifest.artifacts[0]).toMatchObject({
      artifactId: setup.artifact.id,
      revisionId: setup.artifact.revision.id,
      version: 1,
      contentSha256: setup.artifact.revision.contentSha256,
    });
    expect(first.approvalSnapshot).toMatchObject({
      reviewId: review.id,
      outcome: "APPROVED",
      note: "Ready for a controlled release.",
    });
    expect((await getReview(requesterContext, review.id)).publication).toMatchObject({
      id: first.id,
      artifactVersion: 1,
    });

    const publicationCount = await getPool().query<{ count: string }>(
      "SELECT count(*) FROM publications WHERE review_id = $1",
      [review.id],
    );
    expect(publicationCount.rows[0].count).toBe("1");
    await expect(
      getPool().query("UPDATE publications SET manifest = manifest WHERE id = $1", [first.id]),
    ).rejects.toThrow("publication and deployment records are immutable");
    await expect(
      getPool().query("DELETE FROM artifact_versions WHERE publication_id = $1", [first.id]),
    ).rejects.toThrow("publication and deployment records are immutable");
  });

  it("binds a publication to environments with append-only deployment sequences", async () => {
    const { setup, requesterContext, reviewerContext, review } = await reviewFixture();
    await decideReview(reviewerContext, review.id, { outcome: "APPROVED" });
    const publication = await createPublication(requesterContext, review.id);
    const environments = await listProjectEnvironments(requesterContext, setup.project.id);
    expect(environments.map((environment) => environment.key)).toEqual([
      "development",
      "staging",
      "production",
    ]);
    const staging = environments.find((environment) => environment.key === "staging");
    expect(staging).toBeDefined();

    await expect(
      deployPublication(requesterContext, {
        environmentId: staging!.id,
        publicationId: publication.id,
        note: "Designer cannot deploy.",
      }),
    ).rejects.toMatchObject({ name: "PermissionDeniedError", permission: "deployment:create" });

    const operatorContext: PrincipalContext = {
      ...requesterContext,
      role: "operator",
      permissions: rolePermissions.operator,
    };
    const first = await deployPublication(operatorContext, {
      environmentId: staging!.id,
      publicationId: publication.id,
      note: "Release candidate",
    });
    const second = await deployPublication(operatorContext, {
      environmentId: staging!.id,
      publicationId: publication.id,
      note: "Reinstalled after infrastructure maintenance",
    });

    expect(first).toMatchObject({ sequence: 1, environmentKey: "staging" });
    expect(second).toMatchObject({ sequence: 2, environmentKey: "staging" });
    expect(second.id).not.toBe(first.id);
    expect(second.bundleSha256).toBe(first.bundleSha256);
    expect((await getPublication(operatorContext, publication.id)).deployments).toHaveLength(2);
    await expect(
      getPool().query("UPDATE deployments SET note = note WHERE id = $1", [first.id]),
    ).rejects.toThrow("publication and deployment records are immutable");

    const events = await getPool().query<{ type: string }>(
      `SELECT type FROM outbox_events
       WHERE aggregate_id = ANY($1::uuid[])
       ORDER BY created_at ASC`,
      [[publication.id, first.id, second.id]],
    );
    expect(events.rows.map((event) => event.type)).toEqual([
      "publication.created",
      "deployment.created",
      "deployment.created",
    ]);
  });
});
