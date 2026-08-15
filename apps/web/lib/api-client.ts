import type {
  AiExperience,
  Artifact,
  ArtifactEditorPresence,
  Deployment,
  DecisionEvaluation,
  DraftSimulationResult,
  Environment,
  InvitationPreview,
  OrganizationInvitation,
  OrganizationLibrary,
  Project,
  ProjectPackage,
  Publication,
  ProcessInstance,
  ProcessInstanceSummary,
  ProcessTask,
  Review,
  ReviewerCandidate,
  ReviewListItem,
  ReviewOutcome,
  TaskAssigneeCandidate,
  TaskOwnerOptions,
  WanaflowNotification,
  WorkGroup,
  WorkspaceMember,
} from "@wanaflow/db";

type ApiEnvelope<T> = { data: T; meta?: Record<string, unknown> };

type ApiFailure = {
  error?: {
    code?: string;
    message?: string;
    currentRevision?: Artifact["revision"];
  };
};

export class WanaflowApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly currentRevision?: Artifact["revision"],
  ) {
    super(message);
    this.name = "WanaflowApiError";
  }
}

async function unwrap<T>(response: Response): Promise<T> {
  const body = (await response.json()) as ApiEnvelope<T> | ApiFailure;
  if (!response.ok || !("data" in body)) {
    const failure = body as ApiFailure;
    throw new WanaflowApiError(
      failure.error?.message ?? `Request failed with status ${response.status}.`,
      response.status,
      failure.error?.code ?? "REQUEST_FAILED",
      failure.error?.currentRevision,
    );
  }
  return body.data;
}

export async function loadLibrary() {
  const response = await fetch("/api/v1/library", {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  return unwrap<OrganizationLibrary>(response);
}

export async function createAiExperience(input: {
  projectId: string;
  title: string;
  description: string;
}) {
  const response = await fetch("/api/v1/ai-experiences", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return unwrap<AiExperience>(response);
}

export async function loadAiExperience(experienceId: string) {
  const response = await fetch(`/api/v1/ai-experiences/${experienceId}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  return unwrap<AiExperience>(response);
}

export async function saveAiExperienceTranscript(experienceId: string, transcript: unknown[]) {
  const response = await fetch(`/api/v1/ai-experiences/${experienceId}`, {
    method: "PATCH",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ transcript }),
  });
  return unwrap<{ updated: true }>(response);
}

export async function shapeAiExperienceArtifact(experienceId: string, input: unknown, signal?: AbortSignal) {
  const response = await fetch(`/api/v1/ai-experiences/${experienceId}/artifacts`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  return unwrap<{
    action: "created" | "updated";
    role: "MAIN" | "FORM" | "DECISION";
    artifact: Artifact;
  }>(response);
}

export async function recordAiChoice(experienceId: string, input: {
  toolCallId: string;
  question: string;
  selection: "SINGLE" | "MULTIPLE";
  options: Array<{ id: string; label: string; description?: string }>;
  answer: string[];
}) {
  const response = await fetch(`/api/v1/ai-experiences/${experienceId}/choices`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return unwrap<{ recorded: true }>(response);
}

export async function loadAiStatus() {
  const response = await fetch("/api/v1/ai-status", {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  return unwrap<{ configured: boolean; model: string }>(response);
}

export async function loadPeople(workspaceId: string) {
  const response = await fetch(`/api/v1/people?workspaceId=${encodeURIComponent(workspaceId)}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  return unwrap<{
    members: WorkspaceMember[];
    invitations: OrganizationInvitation[];
    groups: WorkGroup[];
  }>(response);
}

export async function invitePerson(input: {
  workspaceId: string;
  email: string;
  displayName: string;
  role: "workspace-admin" | "designer" | "reviewer" | "operator" | "task-worker";
}) {
  const response = await fetch("/api/v1/invitations", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return unwrap<OrganizationInvitation>(response);
}

export async function revokeInvitation(invitationId: string) {
  const response = await fetch(`/api/v1/invitations/${invitationId}`, { method: "DELETE" });
  if (!response.ok) throw new WanaflowApiError("The invitation could not be withdrawn.", response.status, "REQUEST_FAILED");
}

export async function loadInvitation(token: string) {
  const response = await fetch(`/api/v1/invitations/${encodeURIComponent(token)}/accept`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  return unwrap<InvitationPreview>(response);
}

export async function acceptWorkspaceInvitation(token: string, password: string) {
  const response = await fetch(`/api/v1/invitations/${encodeURIComponent(token)}/accept`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  return unwrap<{ accepted: true; signInUrl: string }>(response);
}

export async function createWorkGroup(input: {
  workspaceId: string;
  key: string;
  name: string;
  memberIds: string[];
}) {
  const response = await fetch("/api/v1/work-groups", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return unwrap<WorkGroup>(response);
}

export async function updateWorkGroup(groupId: string, input: { name: string; memberIds: string[] }) {
  const response = await fetch(`/api/v1/work-groups/${groupId}`, {
    method: "PATCH",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return unwrap<WorkGroup>(response);
}

export async function loadTaskOwnerOptions(projectId: string) {
  const response = await fetch(`/api/v1/projects/${projectId}/task-owners`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  return unwrap<TaskOwnerOptions>(response);
}

export async function loadProjectPackage(projectId: string) {
  const response = await fetch(`/api/v1/projects/${projectId}/package`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  return unwrap<ProjectPackage>(response);
}

export async function importProjectPackage(workspaceId: string, projectPackage: ProjectPackage) {
  const response = await fetch(`/api/v1/workspaces/${workspaceId}/package`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(projectPackage),
  });
  return unwrap<Project>(response);
}

export async function loadNotifications(unreadOnly = false) {
  const response = await fetch(`/api/v1/notifications?unread=${unreadOnly}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  return unwrap<WanaflowNotification[]>(response);
}

export async function markNotificationRead(notificationId: string) {
  const response = await fetch(`/api/v1/notifications/${notificationId}`, { method: "PATCH" });
  return unwrap<{ updated: true }>(response);
}

export async function markAllNotificationsRead() {
  const response = await fetch("/api/v1/notifications", { method: "PATCH" });
  return unwrap<{ updated: number }>(response);
}

export async function loadArtifact(artifactId: string) {
  const response = await fetch(`/api/v1/artifacts/${artifactId}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  return unwrap<Artifact>(response);
}

export async function saveArtifact(
  artifactId: string,
  baseRevisionId: string,
  source: string,
) {
  const response = await fetch(`/api/v1/artifacts/${artifactId}/revisions`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "If-Match": `"${baseRevisionId}"`,
    },
    body: JSON.stringify({ source }),
  });
  return unwrap<Artifact>(response);
}

export async function touchArtifactPresence(
  artifactId: string,
  input: {
    revisionId: string;
    clientId: string;
    selectedElementId?: string | null;
    cursor?: { x: number; y: number } | null;
    state?: "ACTIVE" | "IDLE";
  },
) {
  const response = await fetch(`/api/v1/artifacts/${artifactId}/presence`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return unwrap<ArtifactEditorPresence[]>(response);
}

export async function leaveArtifactPresence(artifactId: string, clientId: string) {
  await fetch(`/api/v1/artifacts/${artifactId}/presence?clientId=${encodeURIComponent(clientId)}`, {
    method: "DELETE",
    headers: { Accept: "application/json" },
    keepalive: true,
  });
}

export async function createProject(workspaceId: string, input: { key: string; name: string }) {
  const response = await fetch(`/api/v1/workspaces/${workspaceId}/projects`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return unwrap<Project>(response);
}

export async function createArtifact(
  projectId: string,
  input: { key: string; name: string; source: string; type: "BPMN_PROCESS" | "DMN_DECISION" | "FORM" },
) {
  const response = await fetch(`/api/v1/projects/${projectId}/artifacts`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return unwrap<Artifact>(response);
}

export async function createBpmnArtifact(
  projectId: string,
  input: { key: string; name: string; source: string },
) {
  return createArtifact(projectId, { ...input, type: "BPMN_PROCESS" });
}

export async function loadReviews() {
  const response = await fetch("/api/v1/reviews", {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  return unwrap<ReviewListItem[]>(response);
}

export async function loadReview(reviewId: string) {
  const response = await fetch(`/api/v1/reviews/${reviewId}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  return unwrap<Review>(response);
}

export async function loadReviewerCandidates(artifactId: string) {
  const response = await fetch(`/api/v1/artifacts/${artifactId}/reviewers`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  return unwrap<ReviewerCandidate[]>(response);
}

export async function requestArtifactReview(
  artifactId: string,
  input: { revisionId: string; reviewerIds: string[]; summary: string },
) {
  const response = await fetch(`/api/v1/artifacts/${artifactId}/reviews`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return unwrap<Review>(response);
}

export async function addReviewComment(
  reviewId: string,
  input: { elementId: string; body: string; mentionedPrincipalIds?: string[] },
) {
  const response = await fetch(`/api/v1/reviews/${reviewId}/comments`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return unwrap<Review>(response);
}

export async function resolveReviewComment(reviewId: string, commentId: string) {
  const response = await fetch(`/api/v1/reviews/${reviewId}/comments/${commentId}/resolve`, {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  return unwrap<Review>(response);
}

export async function submitReviewDecision(
  reviewId: string,
  input: { outcome: ReviewOutcome; note?: string },
) {
  const response = await fetch(`/api/v1/reviews/${reviewId}/decision`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return unwrap<Review>(response);
}

export async function cancelReview(reviewId: string) {
  const response = await fetch(`/api/v1/reviews/${reviewId}/cancel`, {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  return unwrap<Review>(response);
}

export async function publishReview(reviewId: string) {
  const response = await fetch(`/api/v1/reviews/${reviewId}/publish`, {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  return unwrap<Publication>(response);
}

export async function loadPublication(publicationId: string) {
  const response = await fetch(`/api/v1/publications/${publicationId}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  return unwrap<Publication>(response);
}

export async function loadProjectEnvironments(projectId: string) {
  const response = await fetch(`/api/v1/projects/${projectId}/environments`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  return unwrap<Environment[]>(response);
}

export async function createProjectEnvironment(
  projectId: string,
  input: { key: string; name: string },
) {
  const response = await fetch(`/api/v1/projects/${projectId}/environments`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return unwrap<Environment>(response);
}

export async function deployToEnvironment(
  environmentId: string,
  input: { publicationId: string; note: string },
) {
  const response = await fetch(`/api/v1/environments/${environmentId}/deploy`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return unwrap<Deployment>(response);
}

export async function startInstance(input: {
  deploymentId: string;
  businessKey?: string;
  variables?: Record<string, unknown>;
}) {
  const response = await fetch("/api/v1/process-instances", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(input),
  });
  return unwrap<ProcessInstance>(response);
}

export async function loadInstances() {
  const response = await fetch("/api/v1/process-instances", {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  return unwrap<ProcessInstanceSummary[]>(response);
}

export async function loadInstance(instanceId: string) {
  const response = await fetch(`/api/v1/process-instances/${instanceId}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  return unwrap<ProcessInstance>(response);
}

export async function loadTasks() {
  const response = await fetch("/api/v1/tasks", {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  return unwrap<ProcessTask[]>(response);
}

export async function completeTask(taskId: string, output: Record<string, unknown>) {
  const response = await fetch(`/api/v1/tasks/${taskId}/complete`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({ output }),
  });
  return unwrap<{ accepted: true; commandId: string; task: ProcessTask }>(response);
}

export async function claimTask(taskId: string) {
  const response = await fetch(`/api/v1/tasks/${taskId}/claim`, {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  return unwrap<ProcessTask>(response);
}

export async function loadIncidentOwners(incidentId: string) {
  const response = await fetch(`/api/v1/incidents/${incidentId}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  return unwrap<TaskAssigneeCandidate[]>(response);
}

export async function updateIncident(
  incidentId: string,
  input: { ownerId?: string | null; note?: string | null },
) {
  const response = await fetch(`/api/v1/incidents/${incidentId}`, {
    method: "PATCH",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return unwrap<ProcessInstance>(response);
}

export async function loadTaskAssignees(taskId: string) {
  const response = await fetch(`/api/v1/tasks/${taskId}/assignment`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  return unwrap<TaskAssigneeCandidate[]>(response);
}

export async function updateTaskAssignment(
  taskId: string,
  input: {
    assigneeId: string;
    dueAt?: string | null;
    priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
    note?: string | null;
  },
) {
  const response = await fetch(`/api/v1/tasks/${taskId}/assignment`, {
    method: "PATCH",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return unwrap<ProcessTask>(response);
}

export async function simulateDraft(
  artifactId: string,
  input: {
    revisionId: string;
    variables: Record<string, unknown>;
    envelope?: DraftSimulationResult["envelope"];
    signal?: { executionId: string; output: Record<string, unknown> };
  },
) {
  const response = await fetch(`/api/v1/artifacts/${artifactId}/simulate`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return unwrap<DraftSimulationResult>(response);
}

export async function retryExternalJob(jobId: string) {
  const response = await fetch(`/api/v1/external-jobs/${jobId}/retry`, {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  return unwrap<{ jobId: string; status: "WAITING"; attempt: number; retryCycle: number }>(response);
}

export async function evaluateDecision(input: {
  deploymentId: string;
  decisionKey: string;
  input: Record<string, unknown>;
  idempotencyKey?: string;
}) {
  const response = await fetch("/api/v1/decision-evaluations", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Idempotency-Key": input.idempotencyKey ?? crypto.randomUUID(),
    },
    body: JSON.stringify({ deploymentId: input.deploymentId, decisionKey: input.decisionKey, input: input.input }),
  });
  return unwrap<DecisionEvaluation>(response);
}
