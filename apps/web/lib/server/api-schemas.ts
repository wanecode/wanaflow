import { z } from "zod";

export const stableKeySchema = z
  .string()
  .min(2)
  .max(63)
  .regex(/^[a-z][a-z0-9-]+$/, "Use lowercase letters, numbers, and hyphens.");

export const createProjectSchema = z.object({
  key: stableKeySchema,
  name: z.string().trim().min(1).max(120),
}).strict();

export const createArtifactSchema = z.object({
  key: stableKeySchema,
  name: z.string().trim().min(1).max(160),
  type: z.enum(["BPMN_PROCESS", "DMN_DECISION", "FORM"]),
  source: z.string().min(1).max(2_097_152),
}).strict();

export const saveRevisionSchema = z.object({
  source: z.string().min(1).max(2_097_152),
}).strict();

export const createAiExperienceSchema = z.object({
  projectId: z.uuid(),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(2_000),
}).strict();

export const updateAiExperienceSchema = z.object({
  transcript: z.array(z.unknown()).max(500),
}).strict().refine(
  (value) => Buffer.byteLength(JSON.stringify(value.transcript), "utf8") <= 2_097_152,
  "The conversation snapshot cannot exceed 2 MiB.",
);

const aiArtifactBaseSchema = z.object({
  key: stableKeySchema,
  name: z.string().trim().min(1).max(160),
});

export const shapeAiArtifactSchema = z.discriminatedUnion("kind", [
  aiArtifactBaseSchema.extend({
    kind: z.literal("MAIN"),
    startLabel: z.string().trim().min(1).max(120).optional(),
    endLabel: z.string().trim().min(1).max(120).optional(),
    steps: z.array(z.object({
      name: z.string().trim().min(1).max(160),
      kind: z.enum(["HUMAN", "SERVICE", "DECISION"]),
      formKey: z.string().trim().regex(/^[a-z][a-z0-9.-]{1,119}$/).optional(),
      formInputMappings: z.array(z.object({
        formField: z.string().min(1).max(128).regex(/^[A-Za-z_][A-Za-z0-9_.-]*$/),
        processVariable: z.string().min(1).max(128).regex(/^[A-Za-z_][A-Za-z0-9_.-]*$/),
      }).strict()).max(30).optional(),
      formOutputMappings: z.array(z.object({
        processVariable: z.string().min(1).max(128).regex(/^[A-Za-z_][A-Za-z0-9_.-]*$/),
        formField: z.string().min(1).max(128).regex(/^[A-Za-z_][A-Za-z0-9_.-]*$/),
      }).strict()).max(30).optional(),
      jobType: z.string().trim().regex(/^[a-z][a-z0-9.-]{1,119}$/).optional(),
      decisionKey: z.string().trim().regex(/^[a-z][a-z0-9.-]{1,119}$/).optional(),
      decisionInputMappings: z.array(z.object({
        decisionInput: z.string().min(1).max(128).regex(/^[A-Za-z_][A-Za-z0-9_.-]*$/),
        processVariable: z.string().min(1).max(128).regex(/^[A-Za-z_][A-Za-z0-9_.-]*$/),
      }).strict()).max(16).optional(),
      decisionOutputMappings: z.array(z.object({
        processVariable: z.string().min(1).max(128).regex(/^[A-Za-z_][A-Za-z0-9_.-]*$/),
        decisionOutput: z.string().min(1).max(128).regex(/^[A-Za-z_][A-Za-z0-9_.-]*$/),
      }).strict()).max(16).optional(),
    }).strict()).min(1).max(12),
  }).strict(),
  aiArtifactBaseSchema.extend({
    kind: z.literal("FORM"),
    description: z.string().trim().max(600).optional(),
    fields: z.array(z.object({
      key: z.string().min(1).max(128).regex(/^[A-Za-z_][A-Za-z0-9_.-]*$/),
      label: z.string().trim().min(1).max(160),
      type: z.enum(["textfield", "textarea", "number", "checkbox", "datetime", "select", "radio"]),
      required: z.boolean().optional(),
      options: z.array(z.object({
        label: z.string().trim().min(1).max(120),
        value: z.string().min(1).max(120),
      }).strict()).min(2).max(20).optional(),
    }).strict()).min(1).max(30),
  }).strict(),
  aiArtifactBaseSchema.extend({
    kind: z.literal("DECISION"),
    hitPolicy: z.enum(["UNIQUE", "FIRST"]),
    inputs: z.array(z.object({
      name: z.string().min(1).max(128).regex(/^[A-Za-z_][A-Za-z0-9_.-]*$/),
      label: z.string().trim().min(1).max(160),
      type: z.enum(["string", "boolean", "number"]),
    }).strict()).min(1).max(8),
    outputs: z.array(z.object({
      name: z.string().min(1).max(128).regex(/^[A-Za-z_][A-Za-z0-9_.-]*$/),
      label: z.string().trim().min(1).max(160),
      type: z.enum(["string", "boolean", "number"]),
    }).strict()).min(1).max(8),
    rules: z.array(z.object({
      description: z.string().trim().max(240).optional(),
      inputEntries: z.array(z.string().max(500)).min(1).max(8),
      outputEntries: z.array(z.string().max(500)).min(1).max(8),
    }).strict()).min(1).max(30),
  }).strict(),
]);

const aiChoiceOptionSchema = z.object({
  id: z.string().min(1).max(80).regex(/^[A-Za-z0-9_.-]+$/),
  label: z.string().trim().min(1).max(160),
  description: z.string().trim().max(300).optional(),
}).strict();

export const recordAiChoiceSchema = z.object({
  toolCallId: z.string().min(1).max(200),
  question: z.string().trim().min(1).max(1_000),
  selection: z.enum(["SINGLE", "MULTIPLE"]),
  options: z.array(aiChoiceOptionSchema).min(2).max(6),
  answer: z.array(z.string().min(1).max(80)).min(1).max(6),
}).strict().superRefine((value, context) => {
  if (value.selection === "SINGLE" && value.answer.length !== 1) {
    context.addIssue({ code: "custom", path: ["answer"], message: "Choose exactly one option." });
  }
  const optionIds = new Set(value.options.map((option) => option.id));
  if (value.answer.some((answer) => !optionIds.has(answer))) {
    context.addIssue({ code: "custom", path: ["answer"], message: "Every answer must reference a provided option." });
  }
});

export const createReviewSchema = z.object({
  revisionId: z.uuid(),
  reviewerIds: z.array(z.uuid()).min(1).max(20),
  summary: z.string().trim().max(2_000).default(""),
}).strict();

export const createReviewCommentSchema = z.object({
  elementId: z.string().min(1).max(255).regex(/^[A-Za-z_][A-Za-z0-9_.:-]*$/),
  body: z.string().trim().min(1).max(4_000),
  mentionedPrincipalIds: z.array(z.uuid()).max(20).optional().default([]),
}).strict();

export const artifactPresenceSchema = z.object({
  revisionId: z.uuid(),
  clientId: z.string().min(8).max(120).regex(/^[A-Za-z0-9_-]+$/),
  selectedElementId: z.string().min(1).max(255).regex(/^[A-Za-z_][A-Za-z0-9_.:-]*$/).nullable().optional(),
  cursor: z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  }).strict().nullable().optional(),
  state: z.enum(["ACTIVE", "IDLE"]).optional().default("ACTIVE"),
}).strict();

export const createInvitationSchema = z.object({
  workspaceId: z.uuid(),
  email: z.email().max(320),
  displayName: z.string().trim().min(1).max(120),
  role: z.enum(["workspace-admin", "designer", "reviewer", "operator", "task-worker"]),
}).strict();

export const acceptInvitationSchema = z.object({
  password: z.string().min(12).max(128),
}).strict();

export const createWorkGroupSchema = z.object({
  workspaceId: z.uuid(),
  key: stableKeySchema,
  name: z.string().trim().min(1).max(120),
  memberIds: z.array(z.uuid()).max(100).default([]),
}).strict();

export const updateWorkGroupSchema = z.object({
  name: z.string().trim().min(1).max(120),
  memberIds: z.array(z.uuid()).max(100),
}).strict();

export const reviewDecisionSchema = z.object({
  outcome: z.enum(["APPROVED", "CHANGES_REQUESTED"]),
  note: z.string().trim().min(1).max(4_000).optional(),
}).strict();

export const createEnvironmentSchema = z.object({
  key: stableKeySchema,
  name: z.string().trim().min(1).max(120),
}).strict();

export const deployPublicationSchema = z.object({
  publicationId: z.uuid(),
  note: z.string().trim().max(2_000).default(""),
}).strict();

const jsonObjectSchema = z.record(z.string(), z.json()).refine(
  (value) => Buffer.byteLength(JSON.stringify(value), "utf8") <= 1_048_576,
  "The JSON object cannot exceed 1 MiB.",
);

export const idempotencyKeySchema = z.string().trim().min(1).max(255);

export const correlateMessageSchema = z.object({
  environmentId: z.uuid(),
  messageName: z.string().trim().min(2).max(120).regex(/^[a-z][a-z0-9.-]+$/),
  correlationKey: z.string().trim().min(1).max(255),
  payload: jsonObjectSchema.optional().default({}),
}).strict();

export const startProcessInstanceSchema = z.object({
  deploymentId: z.uuid(),
  businessKey: z.string().trim().min(1).max(255).nullable().optional(),
  variables: jsonObjectSchema.optional().default({}),
  idempotencyKey: z.string().trim().min(1).max(255).nullable().optional(),
}).strict();

export const evaluateDecisionSchema = z.object({
  deploymentId: z.uuid(),
  decisionKey: z.string().trim().min(2).max(120).regex(/^[a-z][a-z0-9.-]+$/),
  input: jsonObjectSchema.optional().default({}),
}).strict();

export const cancelProcessInstanceSchema = z.object({
  reason: z.string().trim().min(1).max(1000).nullable().optional(),
}).strict();

export const completeProcessTaskSchema = z.object({
  output: jsonObjectSchema.optional().default({}),
  idempotencyKey: z.string().trim().min(1).max(255).nullable().optional(),
}).strict();

export const updateProcessTaskAssignmentSchema = z.object({
  assigneeId: z.uuid(),
  dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  note: z.string().trim().min(1).max(1_000).nullable().optional(),
}).strict();

export const updateRuntimeIncidentSchema = z.object({
  ownerId: z.uuid().nullable().optional(),
  note: z.string().trim().min(1).max(2_000).nullable().optional(),
}).strict();

export const draftSimulationSchema = z.object({
  revisionId: z.uuid(),
  variables: jsonObjectSchema.optional().default({}),
  envelope: z.json().optional(),
  signal: z.object({
    executionId: z.string().min(1).max(255),
    output: jsonObjectSchema.optional().default({}),
  }).strict().optional(),
}).strict().superRefine((value, context) => {
  if (Boolean(value.envelope) !== Boolean(value.signal)) {
    context.addIssue({
      code: "custom",
      path: [value.envelope ? "signal" : "envelope"],
      message: "A continued simulation requires both its envelope and signal.",
    });
  }
  if (Buffer.byteLength(JSON.stringify(value.envelope ?? {}), "utf8") > 2_097_152) {
    context.addIssue({ code: "custom", path: ["envelope"], message: "The simulation envelope cannot exceed 2 MiB." });
  }
});

const jobTypeSchema = z.string().trim().min(2).max(120).regex(/^[a-z][a-z0-9.-]+$/);

export const createWorkerCredentialSchema = z.object({
  projectId: z.uuid(),
  name: z.string().trim().min(1).max(120),
}).strict();

export const lockExternalJobsSchema = z.object({
  workerId: z.string().trim().min(1).max(255),
  jobTypes: z.array(jobTypeSchema).min(1).max(50),
  maxJobs: z.number().int().min(1).max(20).optional().default(1),
}).strict();

const jobLeaseSchema = z.object({
  deliveryId: z.uuid(),
  workerId: z.string().trim().min(1).max(255),
  fencingToken: z.number().int().positive(),
});

export const heartbeatExternalJobSchema = jobLeaseSchema.strict();

export const completeExternalJobSchema = jobLeaseSchema.extend({
  result: jsonObjectSchema.optional().default({}),
  idempotencyKey: z.string().trim().min(1).max(255).nullable().optional(),
}).strict();

export const failExternalJobSchema = jobLeaseSchema.extend({
  code: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(4000),
}).strict();
