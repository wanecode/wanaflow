import type { ArtifactValidationResult, BpmnElementReference } from "@wanaflow/modeling";

export type ArtifactType = "BPMN_PROCESS" | "DMN_DECISION" | "FORM";

export type Organization = {
  id: string;
  key: string;
  name: string;
};

export type Workspace = {
  id: string;
  organizationId: string;
  key: string;
  name: string;
};

export type Project = {
  id: string;
  organizationId: string;
  workspaceId: string;
  key: string;
  name: string;
};

export type Principal = {
  id: string;
  organizationId: string;
  authUserId?: string;
  email: string;
  displayName: string;
};

export type MembershipRole =
  | "organization-owner"
  | "workspace-admin"
  | "designer"
  | "reviewer"
  | "operator"
  | "task-worker";

export type WanaflowPermission =
  | "project:read"
  | "project:create"
  | "artifact:read"
  | "artifact:create"
  | "artifact:update"
  | "review:read"
  | "review:create"
  | "review:comment"
  | "review:decide"
  | "review:cancel"
  | "publication:read"
  | "publication:create"
  | "environment:read"
  | "environment:create"
  | "deployment:read"
  | "deployment:create"
  | "instance:read"
  | "instance:start"
  | "instance:cancel"
  | "task:read"
  | "task:complete"
  | "task:assign"
  | "membership:manage"
  | "notification:read"
  | "job:read"
  | "job:retry"
  | "timer:read"
  | "message:read"
  | "message:correlate"
  | "decision:read"
  | "decision:evaluate"
  | "worker-credential:read"
  | "worker-credential:create"
  | "worker-credential:revoke";

export type ArtifactRevision = {
  id: string;
  artifactId: string;
  number: number;
  source: string;
  contentSha256: string;
  validation: ArtifactValidationResult;
  createdAt: string;
  createdBy: {
    id: string;
    displayName: string;
  };
};

export type Artifact = {
  id: string;
  organizationId: string;
  projectId: string;
  key: string;
  name: string;
  type: ArtifactType;
  revision: ArtifactRevision;
  createdAt: string;
  updatedAt: string;
};

export type PrincipalContext = {
  organization: Organization;
  principal: Principal;
  role: MembershipRole;
  workspaceScopeId: string | null;
  permissions: WanaflowPermission[];
};

export type ProjectLibrary = Project & {
  artifacts: Artifact[];
};

export type WorkspaceLibrary = Workspace & {
  projects: ProjectLibrary[];
};

export type OrganizationLibrary = PrincipalContext & {
  workspaces: WorkspaceLibrary[];
};

export type AiExperienceArtifactRole = "MAIN" | "FORM" | "DECISION";

export type AiExperienceEvent = {
  id: string;
  kind: string;
  label: string;
  detail: Record<string, unknown>;
  createdAt: string;
};

export type AiExperienceArtifact = {
  role: AiExperienceArtifactRole;
  artifact: Artifact;
};

export type AiExperience = {
  id: string;
  organizationId: string;
  projectId: string;
  title: string;
  description: string;
  status: "ACTIVE" | "ARCHIVED";
  transcript: unknown[];
  artifacts: AiExperienceArtifact[];
  events: AiExperienceEvent[];
  createdBy: Pick<Principal, "id" | "displayName">;
  createdAt: string;
  updatedAt: string;
};

export type ReviewStatus = "OPEN" | "APPROVED" | "CHANGES_REQUESTED" | "CANCELLED";

export type ReviewOutcome = "APPROVED" | "CHANGES_REQUESTED";

export type ReviewPrincipal = Pick<Principal, "id" | "displayName" | "email">;

export type WorkspaceMember = ReviewPrincipal & {
  workspaceId: string | null;
  role: MembershipRole;
  joinedAt: string;
};

export type WorkGroup = {
  id: string;
  workspaceId: string;
  key: string;
  name: string;
  members: ReviewPrincipal[];
  createdAt: string;
};

export type OrganizationInvitation = {
  id: string;
  workspaceId: string;
  email: string;
  displayName: string;
  role: Exclude<MembershipRole, "organization-owner">;
  invitedBy: ReviewPrincipal;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  acceptUrl?: string;
};

export type InvitationPreview = {
  organization: Pick<Organization, "id" | "name">;
  workspace: Pick<Workspace, "id" | "name">;
  email: string;
  displayName: string;
  role: Exclude<MembershipRole, "organization-owner">;
  expiresAt: string;
  existingAccount: boolean;
};

export type NotificationKind =
  | "INVITATION_ACCEPTED"
  | "REVIEW_REQUESTED"
  | "REVIEW_MENTIONED"
  | "REVIEW_DECIDED"
  | "TASK_AVAILABLE"
  | "TASK_HANDED_OFF"
  | "INCIDENT_OPENED"
  | "INCIDENT_ASSIGNED"
  | "INCIDENT_RESOLVED";

export type WanaflowNotification = {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  href: string;
  actor: ReviewPrincipal | null;
  resourceType: string;
  resourceId: string;
  readAt: string | null;
  createdAt: string;
};

export type ReviewAssignment = {
  id: string;
  reviewer: ReviewPrincipal;
  assignedBy: ReviewPrincipal;
  createdAt: string;
};

export type ReviewComment = {
  id: string;
  elementId: string;
  elementName: string;
  body: string;
  author: ReviewPrincipal;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: ReviewPrincipal | null;
  mentions: ReviewPrincipal[];
};

export type ReviewChangeSummary = {
  previousRevisionNumber: number | null;
  sourceChanged: boolean;
  addedElements: BpmnElementReference[];
  removedElements: BpmnElementReference[];
};

export type ReviewDecision = {
  id: string;
  outcome: ReviewOutcome;
  note: string | null;
  decidedBy: ReviewPrincipal;
  createdAt: string;
};

export type ReviewActivity = {
  id: string;
  action: string;
  actor: ReviewPrincipal;
  details: Record<string, unknown>;
  createdAt: string;
};

export type ReviewCapabilities = {
  canComment: boolean;
  canDecide: boolean;
  canCancel: boolean;
  canPublish: boolean;
  canDeploy: boolean;
  decisionBlockedReason: string | null;
};

export type PublicationPrincipal = Pick<Principal, "id" | "displayName" | "email">;

export type ArtifactVersion = {
  id: string;
  artifact: Pick<Artifact, "id" | "key" | "name" | "type">;
  revisionId: string;
  revisionNumber: number;
  version: number;
  contentSha256: string;
  createdAt: string;
};

export type PublicationSummary = {
  id: string;
  reviewId: string;
  artifactVersion: number;
  manifestSha256: string;
  publishedBy: PublicationPrincipal;
  deploymentCount: number;
  createdAt: string;
};

export type Deployment = {
  id: string;
  publicationId: string;
  environmentId: string;
  environmentKey: string;
  sequence: number;
  contentSha256: string;
  bundleSha256: string;
  note: string;
  deployedBy: PublicationPrincipal;
  createdAt: string;
};

export type DecisionEvaluation = {
  id: string;
  deploymentId: string;
  environmentId: string;
  decisionArtifactVersionId: string;
  decisionKey: string;
  decision: { id: string; name: string; hitPolicy: "UNIQUE" | "FIRST" };
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  matchedRuleIds: string[];
  outcome: "MATCHED" | "NO_MATCH";
  source: {
    instanceId: string;
    elementId: string;
    elementName: string;
    checkpointRevision: number;
  } | null;
  createdBy: ReviewPrincipal | null;
  createdAt: string;
};

export type Publication = PublicationSummary & {
  organizationId: string;
  projectId: string;
  manifest: {
    schemaVersion: 1;
    artifacts: Array<{
      artifactId: string;
      revisionId: string;
      key: string;
      type: ArtifactType;
      version: number;
      contentSha256: string;
    }>;
  };
  validationSnapshot: ArtifactValidationResult;
  approvalSnapshot: {
    reviewId: string;
    decisionId: string;
    outcome: "APPROVED";
    decidedBy: PublicationPrincipal;
    decidedAt: string;
    note: string | null;
  };
  artifactVersions: ArtifactVersion[];
  deployments: Deployment[];
};

export type Environment = {
  id: string;
  organizationId: string;
  projectId: string;
  key: string;
  name: string;
  deploymentCount: number;
  latestDeployment: Deployment | null;
  createdAt: string;
};

export type Review = {
  id: string;
  organizationId: string;
  projectId: string;
  artifact: Pick<Artifact, "id" | "key" | "name" | "type">;
  revision: ArtifactRevision;
  dependencies: Array<{
    artifact: Pick<Artifact, "id" | "key" | "name" | "type">;
    revisionId: string;
    revisionNumber: number;
    contentSha256: string;
  }>;
  status: ReviewStatus;
  summary: string;
  requestedBy: ReviewPrincipal;
  assignments: ReviewAssignment[];
  comments: ReviewComment[];
  decision: ReviewDecision | null;
  activity: ReviewActivity[];
  publicationEligible: boolean;
  publication: PublicationSummary | null;
  capabilities: ReviewCapabilities;
  elements: BpmnElementReference[];
  changes: ReviewChangeSummary;
  createdAt: string;
  decidedAt: string | null;
  cancelledAt: string | null;
};

export type ReviewListItem = Omit<Review, "comments" | "activity" | "elements" | "dependencies"> & {
  commentCount: number;
  unresolvedCommentCount: number;
};

export type ReviewerCandidate = ReviewPrincipal & {
  role: Extract<MembershipRole, "organization-owner" | "workspace-admin" | "reviewer">;
  eligible: boolean;
  ineligibleReason: string | null;
};

export type LocalSetup = {
  organization: Organization;
  workspace: Workspace;
  project: Project;
  principal: Principal;
  artifact: Artifact;
};

export type ProcessInstanceStatus =
  | "STARTING"
  | "RUNNING"
  | "WAITING"
  | "COMPLETED"
  | "INCIDENT"
  | "CANCELLED";

export type ProcessInstanceSummary = {
  id: string;
  deploymentId: string;
  environment: { id: string; key: string; name: string };
  processName: string;
  businessKey: string | null;
  status: ProcessInstanceStatus;
  revision: number;
  currentElement: { id: string; name: string } | null;
  startedBy: ReviewPrincipal;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type ProcessExecutionEvent = {
  id: string;
  sequence: number;
  checkpointRevision: number;
  type: string;
  element: { id: string; name: string } | null;
  actor: ReviewPrincipal | null;
  data: Record<string, unknown>;
  createdAt: string;
};

export type RuntimeIncident = {
  id: string;
  code: string;
  message: string;
  status: "OPEN" | "RESOLVED";
  createdAt: string;
  resolvedAt: string | null;
  owner: ReviewPrincipal | null;
  notes: RuntimeIncidentNote[];
  jobId: string | null;
  timerId: string | null;
  subscriptionId: string | null;
};

export type RuntimeIncidentNote = {
  id: string;
  action: "NOTE" | "OWNER_CHANGED" | "RETRY_STARTED" | "RESOLVED";
  body: string | null;
  author: ReviewPrincipal;
  createdAt: string;
};

export type ExternalJobDelivery = {
  id: string;
  attempt: number;
  retryCycle: number;
  cycleAttempt: number;
  status: "AVAILABLE" | "LOCKED" | "FAILED" | "SUCCEEDED" | "SUPERSEDED";
  availableAt: string;
  workerId: string | null;
  fencingToken: number;
  lockExpiresAt: string | null;
  failure: { code: string; message: string } | null;
  createdAt: string;
  finishedAt: string | null;
};

export type ExternalJob = {
  id: string;
  instanceId: string;
  processName: string;
  businessKey: string | null;
  checkpointRevision: number;
  elementId: string;
  elementName: string;
  jobType: string;
  input: Record<string, unknown>;
  headers: Record<string, null | boolean | number | string>;
  effectKey: string;
  status: "WAITING" | "COMPLETED" | "CANCELLED";
  completionPending: boolean;
  maxAttempts: number;
  retryBackoffSeconds: number;
  deliveries: ExternalJobDelivery[];
  createdAt: string;
  completedAt: string | null;
};

export type ProcessTimer = {
  id: string;
  instanceId: string;
  processName: string;
  businessKey: string | null;
  checkpointRevision: number;
  elementId: string;
  elementName: string;
  timerType: "DURATION" | "DATE";
  expression: string;
  durationMilliseconds: number | null;
  dueAt: string;
  status: "WAITING" | "FIRED" | "CANCELLED";
  completionPending: boolean;
  createdAt: string;
  firedAt: string | null;
};

export type MessageSubscription = {
  id: string;
  instanceId: string;
  processName: string;
  businessKey: string | null;
  environment: { id: string; key: string; name: string };
  checkpointRevision: number;
  elementId: string;
  elementName: string;
  messageName: string;
  correlationKey: string;
  status: "WAITING" | "CONSUMED" | "CANCELLED";
  completionPending: boolean;
  payload: Record<string, unknown> | null;
  createdAt: string;
  consumedAt: string | null;
};

export type MessageCorrelationResult = {
  outcome: "CORRELATED" | "NO_MATCH" | "AMBIGUOUS";
  attemptId: string;
  commandId: string | null;
  subscription: MessageSubscription | null;
};

export type MessageDelivery = {
  id: string;
  instanceId: string;
  processName: string;
  businessKey: string | null;
  environment: { id: string; key: string; name: string };
  checkpointRevision: number;
  elementId: string;
  elementName: string;
  messageName: string;
  correlationKey: string;
  payload: Record<string, unknown>;
  status: "AVAILABLE" | "CLAIMED" | "DELIVERED" | "NO_MATCH" | "AMBIGUOUS";
  attempts: number;
  correlationAttemptId: string | null;
  targetSubscriptionId: string | null;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
};

export type LockedExternalJob = Pick<ExternalJob,
  "id" | "instanceId" | "processName" | "businessKey" | "elementId" | "elementName" |
  "jobType" | "input" | "headers" | "effectKey"
> & {
  deliveryId: string;
  attempt: number;
  retryCycle: number;
  cycleAttempt: number;
  fencingToken: number;
  lockExpiresAt: string;
};

export type WorkerCredential = {
  id: string;
  projectId: string;
  name: string;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type JobWorkerContext = {
  organizationId: string;
  projectId: string;
  credentialId: string;
  createdBy: string;
};

export type ProcessInstance = ProcessInstanceSummary & {
  projectId: string;
  publicationId: string;
  artifactVersionId: string;
  variables: Record<string, unknown>;
  events: ProcessExecutionEvent[];
  incidents: RuntimeIncident[];
  jobs: ExternalJob[];
  timers: ProcessTimer[];
  messageSubscriptions: MessageSubscription[];
  messageDeliveries: MessageDelivery[];
  decisionEvaluations: DecisionEvaluation[];
  checkpoint: {
    revision: number;
    envelopeSha256: string;
    projectionSha256: string;
    adapter: { name: string; version: string; engineVersion: string };
  } | null;
};

export type ProcessTask = {
  id: string;
  instanceId: string;
  processName: string;
  businessKey: string | null;
  elementId: string;
  elementName: string;
  status: "OPEN" | "COMPLETED" | "CANCELLED";
  completionPending: boolean;
  assignee: ReviewPrincipal | null;
  candidateGroup: Pick<WorkGroup, "id" | "key" | "name"> | null;
  claimable: boolean;
  dueAt: string | null;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  delegatedFrom: ReviewPrincipal | null;
  delegatedBy: ReviewPrincipal | null;
  delegatedAt: string | null;
  assignmentHistory: ProcessTaskAssignmentEvent[];
  variables: Record<string, unknown>;
  form: {
    key: string;
    versionId: string;
    schema: Record<string, unknown>;
    schemaSha256: string;
    data: Record<string, unknown>;
  } | null;
  submission: Record<string, unknown> | null;
  createdAt: string;
  completedAt: string | null;
};

export type ProcessTaskAssignmentEvent = {
  id: string;
  fromAssignee: ReviewPrincipal | null;
  toAssignee: ReviewPrincipal;
  changedBy: ReviewPrincipal;
  dueAt: string | null;
  note: string | null;
  createdAt: string;
};

export type TaskAssigneeCandidate = ReviewPrincipal & {
  role: MembershipRole;
};

export type TaskOwnerOptions = {
  people: TaskAssigneeCandidate[];
  groups: WorkGroup[];
};

export type ProjectPackage = {
  schemaVersion: 1;
  exportedAt: string;
  project: { key: string; name: string };
  artifacts: Array<{
    key: string;
    name: string;
    type: ArtifactType;
    source: string;
    contentSha256: string;
  }>;
};

export type ArtifactEditorPresence = {
  id: string;
  artifactId: string;
  revisionId: string;
  currentRevisionId: string;
  clientId: string;
  principal: ReviewPrincipal;
  selectedElement: { id: string; name: string; type: string } | null;
  cursor: { x: number; y: number } | null;
  state: "ACTIVE" | "IDLE";
  isCurrentRevision: boolean;
  lastSeenAt: string;
};

export type DraftSimulationResult = {
  status: "WAITING" | "COMPLETED";
  revisionId: string;
  sourceSha256: string;
  envelope: import("@wanaflow/runtime").RuntimeEnvelope;
  waits: import("@wanaflow/runtime").RuntimeWait[];
  events: import("@wanaflow/runtime").RuntimeActivityEvent[];
  decisionEvaluations: import("@wanaflow/runtime").RuntimeDecisionEvaluation[];
  variables: import("@wanaflow/runtime").RuntimeVariables;
};
