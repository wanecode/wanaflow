import { randomUUID } from "node:crypto";

import { expect, request as requestFactory, test, type APIRequestContext, type Page } from "@playwright/test";

const owner = {
  email: "owner@wanaflow.test",
  password: "Wanaflow-test-2026!",
};

const reviewer = {
  email: "reviewer@wanaflow.test",
  password: "Wanaflow-reviewer-test-2026!",
};

type LibraryResponse = {
  data: {
    organization: { id: string };
    role: string;
    workspaces: Array<{ id: string; projects: Array<{ id: string; artifacts: Array<{ id: string; key: string }> }> }>;
  };
};

type ArtifactResponse = {
  data: {
    id: string;
    revision: { id: string; number: number; source: string };
  };
};

type ReviewerResponse = {
  data: Array<{ id: string; displayName: string; eligible: boolean }>;
};

type ReviewResponse = {
  data: { id: string; status: string; revision: { id: string } };
};

function seededReviewer(candidates: ReviewerResponse["data"]) {
  const candidate = candidates.find(
    (item) => item.eligible && item.displayName === "Moussa Diop",
  );
  if (!candidate) throw new Error("The seeded independent reviewer is unavailable.");
  return candidate;
}

function processSource(name: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_Api" targetNamespace="https://wanaflow.dev/test">
  <bpmn:process id="api-process" name="${name}" isExecutable="true">
    <bpmn:startEvent id="start"><bpmn:outgoing>flow</bpmn:outgoing></bpmn:startEvent>
    <bpmn:endEvent id="end"><bpmn:incoming>flow</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="flow" sourceRef="start" targetRef="end" />
  </bpmn:process>
</bpmn:definitions>`;
}

async function signInApi(request: APIRequestContext) {
  const response = await request.post("/api/auth/sign-in/email", {
    data: { ...owner, rememberMe: false },
  });
  expect(response.status()).toBe(200);
}

async function signInPage(page: Page, destination = "/", credentials = owner) {
  await page.goto(destination);
  await expect(page).toHaveURL(/\/sign-in\?next=/);
  await page.getByLabel("Email").fill(credentials.email);
  await page.getByLabel("Password").fill(credentials.password);
  await page.getByRole("button", { name: "Enter Wanaflow" }).click();
  await expect(page).toHaveURL(new RegExp(`${destination.replaceAll("/", "\\/")}$`));
}

const routes = [
  ["/", "Recent design work"],
  ["/library", "Process library"],
  ["/reviews", "Does this exact revision look right?"],
  ["/inbox", "My work"],
  ["/operations", "Instances"],
] as const;

function humanTaskSource(name: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_Runtime" targetNamespace="https://wanaflow.dev/test/runtime">
  <bpmn:process id="runtime-process" name="${name}" isExecutable="true">
    <bpmn:startEvent id="start" name="Request received" />
    <bpmn:userTask id="approve" name="Approve request" />
    <bpmn:endEvent id="end" name="Request approved" />
    <bpmn:sequenceFlow id="to-approve" sourceRef="start" targetRef="approve" />
    <bpmn:sequenceFlow id="to-end" sourceRef="approve" targetRef="end" />
  </bpmn:process>
</bpmn:definitions>`;
}

function externalJobSource(name: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:wanaflow="https://wanaflow.dev/schema/bpmn" id="Definitions_Job" targetNamespace="https://wanaflow.dev/test/job">
  <bpmn:process id="job-process" name="${name}" isExecutable="true">
    <bpmn:startEvent id="start" name="Invoice received" />
    <bpmn:serviceTask id="send" name="Send invoice" wanaflow:jobType="invoice.send" wanaflow:jobInputMapping="{&quot;invoiceId&quot;:&quot;invoiceId&quot;}" wanaflow:jobOutputMapping="{&quot;receiptId&quot;:&quot;receipt&quot;}" wanaflow:jobHeaders="{&quot;region&quot;:&quot;west&quot;}" wanaflow:jobLockDuration="PT30S" wanaflow:jobMaxAttempts="2" wanaflow:jobRetryBackoff="PT1S" />
    <bpmn:endEvent id="end" name="Invoice sent" />
    <bpmn:sequenceFlow id="to-send" sourceRef="start" targetRef="send" />
    <bpmn:sequenceFlow id="to-end" sourceRef="send" targetRef="end" />
  </bpmn:process>
</bpmn:definitions>`;
}

function timerSource(name: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_Timer" targetNamespace="https://wanaflow.dev/test/timer">
  <bpmn:process id="timer-process" name="${name}" isExecutable="true">
    <bpmn:startEvent id="start" name="Window opened" />
    <bpmn:intermediateCatchEvent id="pause" name="Wait for review window">
      <bpmn:timerEventDefinition><bpmn:timeDuration>PT1H</bpmn:timeDuration></bpmn:timerEventDefinition>
    </bpmn:intermediateCatchEvent>
    <bpmn:endEvent id="end" name="Window closed" />
    <bpmn:sequenceFlow id="to-pause" sourceRef="start" targetRef="pause" />
    <bpmn:sequenceFlow id="to-end" sourceRef="pause" targetRef="end" />
  </bpmn:process>
</bpmn:definitions>`;
}

function messageSource(name: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:wanaflow="https://wanaflow.dev/schema/bpmn" id="Definitions_Message" targetNamespace="https://wanaflow.dev/test/message">
  <bpmn:message id="Message_expense_approved" name="expense.approved" />
  <bpmn:process id="message-process" name="${name}" isExecutable="true">
    <bpmn:startEvent id="start" name="Expense opened" />
    <bpmn:intermediateCatchEvent id="listen" name="Wait for finance" wanaflow:correlationKey="expenseId">
      <bpmn:messageEventDefinition messageRef="Message_expense_approved" />
    </bpmn:intermediateCatchEvent>
    <bpmn:endEvent id="end" name="Finance answered" />
    <bpmn:sequenceFlow id="to-listen" sourceRef="start" targetRef="listen" />
    <bpmn:sequenceFlow id="to-end" sourceRef="listen" targetRef="end" />
  </bpmn:process>
</bpmn:definitions>`;
}

function messageThrowSource(name: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:wanaflow="https://wanaflow.dev/schema/bpmn" id="Definitions_Message_Throw" targetNamespace="https://wanaflow.dev/test/message-throw">
  <bpmn:message id="Message_expense_approved" name="expense.approved" />
  <bpmn:process id="message-throw-process" name="${name}" isExecutable="true">
    <bpmn:startEvent id="start" name="Expense approved" />
    <bpmn:intermediateThrowEvent id="send" name="Tell finance" wanaflow:correlationKey="expenseId" wanaflow:messagePayloadMapping="{&quot;approvalRef&quot;:&quot;approvalRef&quot;}">
      <bpmn:messageEventDefinition messageRef="Message_expense_approved" />
    </bpmn:intermediateThrowEvent>
    <bpmn:endEvent id="end" name="Finance told" />
    <bpmn:sequenceFlow id="to-send" sourceRef="start" targetRef="send" />
    <bpmn:sequenceFlow id="to-end" sourceRef="send" targetRef="end" />
  </bpmn:process>
</bpmn:definitions>`;
}

function portableFormSource(name: string) {
  return JSON.stringify({
    schemaVersion: 19,
    type: "default",
    id: "qa-form",
    components: [
      { id: "intro", type: "text", text: `# ${name}\n\nA focused task form.` },
      { id: "decision", type: "textfield", key: "decision", label: "Decision", validate: { required: true } },
    ],
  });
}

function collectBrowserErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

test("the visual theme switches without a flash and persists", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "default");

  await page.getByRole("button", { name: "Choose theme" }).click();
  await page.getByText("Claude", { exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "claude");
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem("wanaflow-theme")))
    .toBe("claude");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "claude");

  await page.getByRole("button", { name: "Choose theme" }).click();
  await page.getByText("Default", { exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "default");
});

test("Create with Wana opens a persistent experience and previews validated artifacts", async ({ page }, testInfo) => {
  const browserErrors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1520, height: 980 });
  await signInPage(page, "/create");
  await expect(page.getByRole("dialog", { name: "What are we making?" })).toBeVisible();
  await page.getByLabel("Title").fill("Supplier onboarding");
  await page.getByLabel("Short description").fill("Collect supplier details, review the risk, and notify procurement when the request is approved.");
  await page.getByRole("button", { name: "Start the conversation" }).click();
  await expect(page).toHaveURL(/\/create\/[0-9a-f-]+$/);
  await expect(page.getByText("Live AI is ready to connect")).toBeVisible();
  await expect(page.getByText("No process yet.")).toBeVisible();

  const experienceId = page.url().split("/").pop()!;
  const processKey = `supplier-${Date.now().toString(36)}`;
  const processResponse = await page.request.post(`/api/v1/ai-experiences/${experienceId}/artifacts`, {
    data: {
      kind: "MAIN",
      key: processKey,
      name: "Supplier onboarding",
      startLabel: "Supplier requested",
      endLabel: "Supplier ready",
      steps: [
        { kind: "HUMAN", name: "Review supplier details" },
        { kind: "SERVICE", name: "Create supplier record", jobType: "supplier.create" },
      ],
    },
  });
  expect(processResponse.status(), await processResponse.text()).toBe(201);

  const requestFormKey = `${processKey}-request`.slice(0, 63);
  const routingDecisionKey = `${processKey}-routing`.slice(0, 63);
  const formResponse = await page.request.post(`/api/v1/ai-experiences/${experienceId}/artifacts`, {
    data: {
      kind: "FORM",
      key: requestFormKey,
      name: "Supplier request",
      fields: [
        { key: "annualAmount", label: "Annual amount", type: "number", required: true },
        { key: "isInternational", label: "International supplier", type: "checkbox", required: true },
      ],
    },
  });
  expect(formResponse.status(), await formResponse.text()).toBe(201);
  const decisionResponse = await page.request.post(`/api/v1/ai-experiences/${experienceId}/artifacts`, {
    data: {
      kind: "DECISION",
      key: routingDecisionKey,
      name: "Supplier review routing",
      hitPolicy: "FIRST",
      inputs: [
        { name: "annualAmount", label: "Annual amount", type: "number" },
        { name: "isInternational", label: "International supplier", type: "boolean" },
      ],
      outputs: [{ name: "reviewRoute", label: "Review route", type: "string" }],
      rules: [
        { inputEntries: ["-", "true"], outputEntries: ["\"finance\""] },
        { inputEntries: ["> 10000", "false"], outputEntries: ["\"finance\""] },
        { inputEntries: ["<= 10000", "false"], outputEntries: ["\"standard\""] },
      ],
    },
  });
  expect(decisionResponse.status(), await decisionResponse.text()).toBe(201);
  const connectedProcessResponse = await page.request.post(`/api/v1/ai-experiences/${experienceId}/artifacts`, {
    data: {
      kind: "MAIN",
      key: processKey,
      name: "Supplier onboarding",
      startLabel: "Supplier requested",
      endLabel: "Supplier ready",
      steps: [
        { kind: "HUMAN", name: "Capture supplier details", formKey: requestFormKey },
        { kind: "DECISION", name: "Route the review", decisionKey: routingDecisionKey },
        { kind: "HUMAN", name: "Approve supplier" },
      ],
    },
  });
  expect(connectedProcessResponse.status(), await connectedProcessResponse.text()).toBe(200);
  const connectedProcess = (await connectedProcessResponse.json()) as { data: { artifact: { id: string; revision: { id: string; source: string } } } };
  expect(connectedProcess.data.artifact.revision.source).toContain(
    'wanaflow:outputMapping="{&quot;annualAmount&quot;:&quot;annualAmount&quot;,&quot;isInternational&quot;:&quot;isInternational&quot;}"',
  );
  expect(connectedProcess.data.artifact.revision.source).toContain(
    'wanaflow:decisionInputMapping="{&quot;annualAmount&quot;:&quot;annualAmount&quot;,&quot;isInternational&quot;:&quot;isInternational&quot;}"',
  );
  expect(connectedProcess.data.artifact.revision.source).toContain(
    'wanaflow:decisionOutputMapping="{&quot;reviewRoute&quot;:&quot;reviewRoute&quot;}"',
  );
  const reviewerCandidates = (await (await page.request.get(
    `/api/v1/artifacts/${connectedProcess.data.artifact.id}/reviewers`,
  )).json()) as ReviewerResponse;
  const candidate = seededReviewer(reviewerCandidates.data);
  const reviewResponse = await page.request.post(
    `/api/v1/artifacts/${connectedProcess.data.artifact.id}/reviews`,
    { data: {
      revisionId: connectedProcess.data.artifact.revision.id,
      reviewerIds: [candidate.id],
      summary: "Review the complete AI-shaped supplier experience.",
    } },
  );
  expect(reviewResponse.status(), await reviewResponse.text()).toBe(201);

  const firstExperience = (await (await page.request.get(`/api/v1/ai-experiences/${experienceId}`)).json()) as { data: { projectId: string } };
  const siblingResponse = await page.request.post("/api/v1/ai-experiences", { data: {
    projectId: firstExperience.data.projectId,
    title: "Supplier onboarding copy",
    description: "Use the same business-friendly key without exposing a collision to the conversation.",
  } });
  expect(siblingResponse.status()).toBe(201);
  const sibling = (await siblingResponse.json()) as { data: { id: string } };
  const scopedArtifactResponse = await page.request.post(`/api/v1/ai-experiences/${sibling.data.id}/artifacts`, { data: {
    kind: "MAIN",
    key: processKey,
    name: "Supplier onboarding copy",
    steps: [{ kind: "HUMAN", name: "Review supplier details", formKey: "supplier-review" }],
  } });
  expect(scopedArtifactResponse.status(), await scopedArtifactResponse.text()).toBe(201);
  const scopedArtifact = (await scopedArtifactResponse.json()) as { data: { artifact: { key: string } } };
  expect(scopedArtifact.data.artifact.key).not.toBe(processKey);
  expect(scopedArtifact.data.artifact.key).toMatch(new RegExp(`^${processKey.slice(0, 50)}`));
  await page.reload();
  await expect(page.locator(".djs-container")).toBeVisible();
  await expect(page.getByText("revision 2 · valid")).toBeVisible();

  await page.getByRole("button", { name: "Debug" }).click();
  await expect(page.getByText(new RegExp(`thread ${experienceId.slice(0, 8)}`))).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("ai-experience-studio.png"), fullPage: true });

  const invalidChoice = await page.request.post(`/api/v1/ai-experiences/${experienceId}/choices`, {
    data: {
      toolCallId: "choice-invalid",
      question: "Who owns the review",
      selection: "SINGLE",
      options: [{ id: "finance", label: "Finance" }],
      answer: ["finance"],
    },
  });
  expect(invalidChoice.status()).toBe(400);
  const validChoice = await page.request.post(`/api/v1/ai-experiences/${experienceId}/choices`, {
    data: {
      toolCallId: "choice-valid",
      question: "Who owns the review",
      selection: "SINGLE",
      options: [
        { id: "finance", label: "Finance" },
        { id: "procurement", label: "Procurement" },
      ],
      answer: ["finance"],
    },
  });
  expect(validChoice.status()).toBe(201);
  expect(browserErrors).toEqual([]);
});

test("a new invitee can open a public invitation and join", async ({ page, request }) => {
  const browserErrors = collectBrowserErrors(page);
  await signInApi(request);
  const library = (await (await request.get("/api/v1/library")).json()) as LibraryResponse;
  const suffix = Date.now().toString(36);
  const email = `invitee-${suffix}@wanaflow.test`;
  const password = "Wanaflow-invitee-test-2026!";
  const invitationResponse = await request.post("/api/v1/invitations", {
    data: {
      workspaceId: library.data.workspaces[0]?.id,
      email,
      displayName: "Aminata Fall",
      role: "reviewer",
    },
  });
  expect(invitationResponse.status()).toBe(201);
  const invitation = (await invitationResponse.json()) as { data: { acceptUrl: string } };

  await page.context().clearCookies();
  await page.goto(invitation.data.acceptUrl);
  await expect(page).toHaveURL(new RegExp(`${invitation.data.acceptUrl}$`));
  await expect(page.getByRole("heading", { name: "Welcome, Aminata Fall." })).toBeVisible();
  await page.getByLabel("Choose a password").fill(password);
  await page.getByRole("button", { name: "Join the workspace" }).click();
  await expect(page.getByRole("heading", { name: "Your workspace is waiting." })).toBeVisible();
  await page.getByRole("link", { name: "Continue to sign in" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Enter Wanaflow" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "Open Aminata Fall account menu" })).toBeVisible();
  expect(browserErrors).toEqual([]);
});

test("artifact API requires a session, scopes tenants, and persists immutable revisions", async ({
  request,
}) => {
  const anonymousResponse = await request.get("/api/v1/library");
  expect(anonymousResponse.status()).toBe(401);
  await expect(anonymousResponse.json()).resolves.toMatchObject({
    error: { code: "AUTHENTICATION_REQUIRED" },
  });

  await signInApi(request);
  const libraryResponse = await request.get("/api/v1/library");
  expect(libraryResponse.status()).toBe(200);
  expect(libraryResponse.headers()["x-wanaflow-auth-mode"]).toBe("session-cookie");
  const library = (await libraryResponse.json()) as LibraryResponse;
  expect(library.data.role).toBe("organization-owner");

  const foreignTenantResponse = await request.get("/api/v1/library", {
    headers: { "X-Wanaflow-Organization": randomUUID() },
  });
  expect(foreignTenantResponse.status()).toBe(404);

  const suffix = Date.now().toString(36);
  const projectResponse = await request.post(
    `/api/v1/workspaces/${library.data.workspaces[0]?.id}/projects`,
    { data: { key: `api-${suffix}`, name: "API contract test" } },
  );
  expect(projectResponse.status()).toBe(201);
  const project = (await projectResponse.json()) as { data: { id: string } };

  const credentialResponse = await request.post("/api/v1/worker-credentials", {
    data: { projectId: project.data.id, name: "Playwright worker" },
  });
  expect(credentialResponse.status()).toBe(201);
  const credential = (await credentialResponse.json()) as { data: { id: string; token: string; tokenPrefix: string } };
  expect(credential.data.token).toMatch(/^wf_job_/);
  expect(credential.data.tokenPrefix).toBe(credential.data.token.slice(0, 16));
  const emptyLock = await request.post("/api/v1/external-jobs/lock", {
    headers: { Authorization: `Bearer ${credential.data.token}` },
    data: { workerId: "playwright-1", jobTypes: ["invoice.send"] },
  });
  expect(emptyLock.status()).toBe(200);
  expect(emptyLock.headers()["x-wanaflow-auth-mode"]).toBe("worker-bearer");
  await expect(emptyLock.json()).resolves.toEqual({ data: [] });
  const revokeResponse = await request.post(`/api/v1/worker-credentials/${credential.data.id}/revoke`);
  expect(revokeResponse.status()).toBe(200);
  const revokedLock = await request.post("/api/v1/external-jobs/lock", {
    headers: { Authorization: `Bearer ${credential.data.token}` },
    data: { workerId: "playwright-1", jobTypes: ["invoice.send"] },
  });
  expect(revokedLock.status()).toBe(401);
  expect(revokedLock.headers()["x-wanaflow-auth-mode"]).toBe("worker-bearer");

  const missingProjectResponse = await request.post(
    "/api/v1/projects/00000000-0000-4000-8000-000000000000/artifacts",
    {
      data: {
        key: "missing-project",
        name: "Missing project",
        type: "BPMN_PROCESS",
        source: processSource("Missing project"),
      },
    },
  );
  expect(missingProjectResponse.status()).toBe(404);

  const createResponse = await request.post(`/api/v1/projects/${project.data.id}/artifacts`, {
    data: {
      key: "invoice-approval",
      name: "Invoice approval",
      type: "BPMN_PROCESS",
      source: processSource("Invoice approval"),
    },
  });
  expect(createResponse.status()).toBe(201);
  const created = (await createResponse.json()) as ArtifactResponse;
  const initialEtag = createResponse.headers().etag;
  expect(initialEtag).toBe(`"${created.data.revision.id}"`);

  const saveResponse = await request.post(
    `/api/v1/artifacts/${created.data.id}/revisions`,
    {
      headers: { "If-Match": initialEtag },
      data: { source: processSource("Invoice approval v2") },
    },
  );
  expect(saveResponse.status()).toBe(201);
  const saved = (await saveResponse.json()) as ArtifactResponse;
  expect(saved.data.revision.number).toBe(2);

  const conflictResponse = await request.post(
    `/api/v1/artifacts/${created.data.id}/revisions`,
    {
      headers: { "If-Match": initialEtag },
      data: { source: processSource("Stale edit") },
    },
  );
  expect(conflictResponse.status()).toBe(409);
  await expect(conflictResponse.json()).resolves.toMatchObject({
    error: {
      code: "REVISION_CONFLICT",
      currentRevision: { id: saved.data.revision.id, number: 2 },
    },
  });

  const unsafeResponse = await request.post(
    `/api/v1/artifacts/${created.data.id}/revisions`,
    {
      headers: { "If-Match": saveResponse.headers().etag },
      data: { source: '<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo />' },
    },
  );
  expect(unsafeResponse.status()).toBe(422);
  await expect(unsafeResponse.json()).resolves.toMatchObject({ error: { code: "UNSAFE_XML" } });

  const getResponse = await request.get(`/api/v1/artifacts/${created.data.id}`);
  expect(getResponse.status()).toBe(200);
  const current = (await getResponse.json()) as ArtifactResponse;
  expect(current.data.revision.id).toBe(saved.data.revision.id);
  expect(current.data.revision.source).toContain("Invoice approval v2");

  const reviewersResponse = await request.get(`/api/v1/artifacts/${created.data.id}/reviewers`);
  expect(reviewersResponse.status()).toBe(200);
  const reviewers = (await reviewersResponse.json()) as ReviewerResponse;
  const independentReviewer = seededReviewer(reviewers.data);
  expect(independentReviewer.displayName).toBe("Moussa Diop");

  const reviewResponse = await request.post(`/api/v1/artifacts/${created.data.id}/reviews`, {
    data: {
      revisionId: saved.data.revision.id,
      reviewerIds: [independentReviewer.id],
      summary: "API review contract",
    },
  });
  expect(reviewResponse.status()).toBe(201);
  const apiReview = (await reviewResponse.json()) as ReviewResponse;
  expect(apiReview.data).toMatchObject({
    status: "OPEN",
    revision: { id: saved.data.revision.id },
  });

  const selfDecision = await request.post(`/api/v1/reviews/${apiReview.data.id}/decision`, {
    data: { outcome: "APPROVED" },
  });
  expect(selfDecision.status()).toBe(409);
  await expect(selfDecision.json()).resolves.toMatchObject({
    error: { code: "REVIEWER_NOT_ASSIGNED" },
  });

  const prematurePublication = await request.post(
    `/api/v1/reviews/${apiReview.data.id}/publish`,
  );
  expect(prematurePublication.status()).toBe(409);
  await expect(prematurePublication.json()).resolves.toMatchObject({
    error: { code: "PUBLICATION_NOT_ELIGIBLE" },
  });

  const environmentsResponse = await request.get(
    `/api/v1/projects/${project.data.id}/environments`,
  );
  expect(environmentsResponse.status()).toBe(200);
  await expect(environmentsResponse.json()).resolves.toMatchObject({
    data: [
      { key: "development", deploymentCount: 0 },
      { key: "staging", deploymentCount: 0 },
      { key: "production", deploymentCount: 0 },
    ],
  });
});

test("immutable deployment starts, waits for assigned work, and completes with a real timeline", async ({ request }) => {
  await signInApi(request);
  const library = (await (await request.get("/api/v1/library")).json()) as LibraryResponse;
  const suffix = Date.now().toString(36);
  const projectResponse = await request.post(`/api/v1/workspaces/${library.data.workspaces[0].id}/projects`, {
    data: { key: `runtime-${suffix}`, name: "Runtime acceptance" },
  });
  const project = (await projectResponse.json()) as { data: { id: string } };
  const artifactResponse = await request.post(`/api/v1/projects/${project.data.id}/artifacts`, {
    data: {
      key: "request-approval",
      name: "Request approval",
      type: "BPMN_PROCESS",
      source: humanTaskSource("Request approval"),
    },
  });
  expect(artifactResponse.status()).toBe(201);
  const artifact = (await artifactResponse.json()) as ArtifactResponse;
  const reviewers = (await (await request.get(`/api/v1/artifacts/${artifact.data.id}/reviewers`)).json()) as ReviewerResponse;
  const independentReviewer = seededReviewer(reviewers.data);
  const reviewResponse = await request.post(`/api/v1/artifacts/${artifact.data.id}/reviews`, {
    data: {
      revisionId: artifact.data.revision.id,
      reviewerIds: [independentReviewer.id],
      summary: "Executable runtime acceptance",
    },
  });
  const review = (await reviewResponse.json()) as ReviewResponse;

  const reviewerRequest = await requestFactory.newContext({ baseURL: "http://127.0.0.1:3100" });
  const reviewerSignIn = await reviewerRequest.post("/api/auth/sign-in/email", {
    data: { ...reviewer, rememberMe: false },
  });
  expect(reviewerSignIn.status(), await reviewerSignIn.text()).toBe(200);
  const decision = await reviewerRequest.post(`/api/v1/reviews/${review.data.id}/decision`, {
    data: { outcome: "APPROVED", note: "Runtime profile is ready." },
  });
  expect(decision.status()).toBe(200);
  await reviewerRequest.dispose();
  const publicationResponse = await request.post(`/api/v1/reviews/${review.data.id}/publish`);
  expect(publicationResponse.status()).toBe(201);
  const publication = (await publicationResponse.json()) as { data: { id: string } };
  const environments = (await (await request.get(`/api/v1/projects/${project.data.id}/environments`)).json()) as { data: Array<{ id: string; key: string }> };
  const development = environments.data.find((environment) => environment.key === "development")!;
  const deploymentResponse = await request.post(`/api/v1/environments/${development.id}/deploy`, {
    data: { publicationId: publication.data.id, note: "Acceptance deployment" },
  });
  expect(deploymentResponse.status()).toBe(201);
  const deployment = (await deploymentResponse.json()) as { data: { id: string } };

  const startResponse = await request.post("/api/v1/process-instances", {
    headers: { "Idempotency-Key": `runtime:${suffix}` },
    data: {
      deploymentId: deployment.data.id,
      businessKey: `request:${suffix}`,
      variables: { amount: 45000, currency: "XOF" },
    },
  });
  expect(startResponse.status()).toBe(202);
  const started = (await startResponse.json()) as { data: { id: string; status: string } };
  expect(started.data.status).toBe("STARTING");

  await expect.poll(async () => {
    const response = await request.get(`/api/v1/process-instances/${started.data.id}`);
    const body = (await response.json()) as { data: { status: string } };
    return body.data.status;
  }, { timeout: 10_000 }).toBe("WAITING");

  const tasksResponse = await request.get("/api/v1/tasks");
  const tasks = (await tasksResponse.json()) as { data: Array<{ id: string; elementName: string; completionPending: boolean }> };
  expect(tasks.data).toEqual([expect.objectContaining({ elementName: "Approve request", completionPending: false })]);
  const completionResponse = await request.post(`/api/v1/tasks/${tasks.data[0].id}/complete`, {
    headers: { "Idempotency-Key": `complete:${suffix}` },
    data: { output: { approved: true, note: "Within delegated limit" } },
  });
  expect(completionResponse.status()).toBe(202);
  await expect(completionResponse.json()).resolves.toMatchObject({ data: { task: { completionPending: true } } });

  await expect.poll(async () => {
    const response = await request.get(`/api/v1/process-instances/${started.data.id}`);
    const body = (await response.json()) as { data: { status: string } };
    return body.data.status;
  }, { timeout: 10_000 }).toBe("COMPLETED");
  const completed = (await (await request.get(`/api/v1/process-instances/${started.data.id}`)).json()) as { data: { revision: number; variables: Record<string, unknown>; events: Array<{ type: string; element?: { id: string } }> } };
  expect(completed.data.revision).toBe(2);
  expect(completed.data.variables).toMatchObject({ amount: 45000, currency: "XOF", approved: true });
  expect(completed.data.events.map((event) => event.type)).toEqual(expect.arrayContaining(["PROCESS_STARTED", "TASK_AVAILABLE", "TASK_COMPLETED", "PROCESS_COMPLETED"]));
});

test("form Studio opens and a BPMN user-task binding survives save", async ({ page, request }, testInfo) => {
  test.setTimeout(60_000);
  await signInApi(request);
  const library = (await (await request.get("/api/v1/library")).json()) as LibraryResponse;
  const projectId = library.data.workspaces[0].projects[0].id;
  const suffix = Date.now().toString(36);
  const formKey = `qa-form-${suffix}`;
  const formResponse = await request.post(`/api/v1/projects/${projectId}/artifacts`, {
    data: {
      key: formKey,
      name: "Quality decision",
      type: "FORM",
      source: portableFormSource("Quality decision"),
    },
  });
  expect(formResponse.status()).toBe(201);
  const form = (await formResponse.json()) as ArtifactResponse;
  const processResponse = await request.post(`/api/v1/projects/${projectId}/artifacts`, {
    data: {
      key: `qa-process-${suffix}`,
      name: "Quality process",
      type: "BPMN_PROCESS",
      source: humanTaskSource("Quality process"),
    },
  });
  expect(processResponse.status()).toBe(201);
  const process = (await processResponse.json()) as ArtifactResponse;

  const browserErrors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1440, height: 960 });
  await signInPage(page, `/forms/${form.data.id}`);
  await expect(page.locator(".fjs-form-editor")).toBeVisible();
  await expect(page.getByText("Ask only what the work needs.")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("desktop-form-studio.png"), fullPage: true });

  await page.goto(`/studio/${process.data.id}`);
  await expect(page.locator(".djs-container")).toBeVisible();
  await page.locator('.djs-element[data-element-id="approve"] .djs-hit').click({ force: true });
  await page.getByLabel("Task form").selectOption(formKey);
  await page.getByText("Data mapping", { exact: true }).click();
  await page.getByPlaceholder("formField = processVariable").fill("decision = proposedDecision");
  await page.getByPlaceholder("processVariable = formField").fill("approvedDecision = decision");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  const saved = (await (await page.request.get(`/api/v1/artifacts/${process.data.id}`)).json()) as ArtifactResponse;
  expect(saved.data.revision.source).toContain(`wanaflow:formKey="${formKey}"`);
  expect(saved.data.revision.source).toContain("wanaflow:inputMapping");
  expect(saved.data.revision.source).toContain("wanaflow:outputMapping");

  const reviewers = (await (await request.get(`/api/v1/artifacts/${process.data.id}/reviewers`)).json()) as ReviewerResponse;
  const reviewerId = seededReviewer(reviewers.data).id;
  const reviewResponse = await request.post(`/api/v1/artifacts/${process.data.id}/reviews`, {
    data: { revisionId: saved.data.revision.id, reviewerIds: [reviewerId], summary: "Form-backed runtime" },
  });
  expect(reviewResponse.status()).toBe(201);
  const review = (await reviewResponse.json()) as { data: { id: string; dependencies: Array<{ artifact: { key: string } }> } };
  expect(review.data.dependencies).toEqual([expect.objectContaining({ artifact: expect.objectContaining({ key: formKey }) })]);

  const reviewerRequest = await requestFactory.newContext({ baseURL: "http://127.0.0.1:3100" });
  const reviewerSignIn = await reviewerRequest.post("/api/auth/sign-in/email", { data: { ...reviewer, rememberMe: false } });
  expect(reviewerSignIn.status()).toBe(200);
  const decisionResponse = await reviewerRequest.post(`/api/v1/reviews/${review.data.id}/decision`, { data: { outcome: "APPROVED" } });
  expect(decisionResponse.status()).toBe(200);
  await reviewerRequest.dispose();

  const publicationResponse = await request.post(`/api/v1/reviews/${review.data.id}/publish`);
  expect(publicationResponse.status()).toBe(201);
  const publication = (await publicationResponse.json()) as { data: { id: string; artifactVersions: unknown[] } };
  expect(publication.data.artifactVersions).toHaveLength(2);
  const environments = (await (await request.get(`/api/v1/projects/${projectId}/environments`)).json()) as { data: Array<{ id: string; key: string }> };
  const deploymentResponse = await request.post(`/api/v1/environments/${environments.data.find((environment) => environment.key === "development")!.id}/deploy`, {
    data: { publicationId: publication.data.id, note: "Form acceptance" },
  });
  expect(deploymentResponse.status()).toBe(201);
  const deployment = (await deploymentResponse.json()) as { data: { id: string } };
  const startResponse = await request.post("/api/v1/process-instances", {
    headers: { "Idempotency-Key": `form-start:${suffix}` },
    data: { deploymentId: deployment.data.id, variables: { proposedDecision: "Review carefully" } },
  });
  expect(startResponse.status()).toBe(202);
  await expect.poll(async () => {
    const tasks = (await (await request.get("/api/v1/tasks")).json()) as { data: Array<{ elementName: string; form: { key: string } | null }> };
    return tasks.data.find((task) => task.elementName === "Approve request")?.form?.key;
  }, { timeout: 10_000 }).toBe(formKey);

  await page.goto("/inbox");
  await expect(page.getByLabel("Decision")).toHaveValue("Review carefully");
  await page.screenshot({ path: testInfo.outputPath("desktop-form-inbox.png"), fullPage: true });
  await page.getByLabel("Decision").fill("Approved");
  await page.getByRole("button", { name: "Complete task" }).click();
  await expect(page.getByText("Checkpoint advanced")).toBeVisible({ timeout: 10_000 });
  expect(browserErrors).toEqual([]);
});

test("external worker locks and completes a service job while Operations explains delivery", async ({ page, request }, testInfo) => {
  await signInApi(request);
  const library = (await (await request.get("/api/v1/library")).json()) as LibraryResponse;
  const suffix = Date.now().toString(36);
  const projectResponse = await request.post(`/api/v1/workspaces/${library.data.workspaces[0].id}/projects`, {
    data: { key: `jobs-${suffix}`, name: "External jobs acceptance" },
  });
  const project = (await projectResponse.json()) as { data: { id: string } };
  const artifactResponse = await request.post(`/api/v1/projects/${project.data.id}/artifacts`, {
    data: { key: "invoice-worker", name: "Invoice worker", type: "BPMN_PROCESS", source: externalJobSource("Invoice worker") },
  });
  expect(artifactResponse.status()).toBe(201);
  const artifact = (await artifactResponse.json()) as ArtifactResponse;
  const candidates = (await (await request.get(`/api/v1/artifacts/${artifact.data.id}/reviewers`)).json()) as ReviewerResponse;
  const reviewerId = seededReviewer(candidates.data).id;
  const reviewResponse = await request.post(`/api/v1/artifacts/${artifact.data.id}/reviews`, {
    data: { revisionId: artifact.data.revision.id, reviewerIds: [reviewerId], summary: "External job contract" },
  });
  const review = (await reviewResponse.json()) as ReviewResponse;
  const reviewerRequest = await requestFactory.newContext({ baseURL: testInfo.project.use.baseURL });
  const reviewerSignIn = await reviewerRequest.post("/api/auth/sign-in/email", { data: { ...reviewer, rememberMe: false } });
  expect(reviewerSignIn.status()).toBe(200);
  const decision = await reviewerRequest.post(`/api/v1/reviews/${review.data.id}/decision`, { data: { outcome: "APPROVED" } });
  expect(decision.status()).toBe(200);
  await reviewerRequest.dispose();

  const publicationResponse = await request.post(`/api/v1/reviews/${review.data.id}/publish`);
  const publication = (await publicationResponse.json()) as { data: { id: string } };
  const environments = (await (await request.get(`/api/v1/projects/${project.data.id}/environments`)).json()) as { data: Array<{ id: string; key: string }> };
  const deploymentResponse = await request.post(`/api/v1/environments/${environments.data.find((environment) => environment.key === "development")!.id}/deploy`, {
    data: { publicationId: publication.data.id, note: "Worker acceptance" },
  });
  const deployment = (await deploymentResponse.json()) as { data: { id: string } };
  const startResponse = await request.post("/api/v1/process-instances", {
    data: { deploymentId: deployment.data.id, businessKey: `invoice:${suffix}`, variables: { invoiceId: "INV-42", privateNote: "not delivered" } },
  });
  expect(startResponse.status()).toBe(202);
  const started = (await startResponse.json()) as { data: { id: string } };
  let jobId = "";
  await expect.poll(async () => {
    const jobs = (await (await request.get(`/api/v1/external-jobs?instanceId=${started.data.id}`)).json()) as { data: Array<{ id: string }> };
    jobId = jobs.data[0]?.id ?? "";
    return jobId;
  }, { timeout: 10_000 }).not.toBe("");

  const credentialResponse = await request.post("/api/v1/worker-credentials", { data: { projectId: project.data.id, name: "Invoice sender" } });
  const credential = (await credentialResponse.json()) as { data: { token: string } };
  const lockResponse = await request.post("/api/v1/external-jobs/lock", {
    headers: { Authorization: `Bearer ${credential.data.token}` },
    data: { workerId: "invoice-worker-1", jobTypes: ["invoice.send"] },
  });
  const locked = (await lockResponse.json()) as { data: Array<{ id: string; deliveryId: string; fencingToken: number; input: Record<string, unknown>; effectKey: string }> };
  expect(locked.data[0]).toMatchObject({ id: jobId, input: { invoiceId: "INV-42" } });

  await signInPage(page, `/operations/${started.data.id}`);
  await expect(page.getByText("invoice.send", { exact: true })).toBeVisible();
  await expect(page.getByText("Locked by invoice-worker-1")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("desktop-external-job-locked.png"), fullPage: true });
  const deliveryStory = page.getByLabel("External job delivery");
  await deliveryStory.scrollIntoViewIfNeeded();
  await deliveryStory.screenshot({ path: testInfo.outputPath("desktop-external-job-delivery.png") });

  const completionResponse = await request.post(`/api/v1/external-jobs/${jobId}/complete`, {
    headers: { Authorization: `Bearer ${credential.data.token}`, "Idempotency-Key": `${jobId}:complete` },
    data: { deliveryId: locked.data[0].deliveryId, workerId: "invoice-worker-1", fencingToken: locked.data[0].fencingToken, result: { receipt: "RECEIPT-42", ignored: true } },
  });
  expect(completionResponse.status()).toBe(202);
  await expect.poll(async () => {
    const detail = (await (await request.get(`/api/v1/process-instances/${started.data.id}`)).json()) as { data: { status: string; variables: Record<string, unknown> } };
    return detail.data;
  }, { timeout: 10_000 }).toMatchObject({ status: "COMPLETED", variables: { invoiceId: "INV-42", privateNote: "not delivered", receiptId: "RECEIPT-42" } });
  await page.reload();
  await expect(page.getByText("Invoice worker is complete.")).toBeVisible();
});

test("timer Studio and Operations keep a PostgreSQL-owned pause understandable", async ({ page, request }, testInfo) => {
  test.setTimeout(75_000);
  await signInApi(request);
  const library = (await (await request.get("/api/v1/library")).json()) as LibraryResponse;
  const suffix = Date.now().toString(36);
  const projectResponse = await request.post(`/api/v1/workspaces/${library.data.workspaces[0].id}/projects`, {
    data: { key: `timers-${suffix}`, name: "Durable timers acceptance" },
  });
  const project = (await projectResponse.json()) as { data: { id: string } };
  const artifactResponse = await request.post(`/api/v1/projects/${project.data.id}/artifacts`, {
    data: { key: "review-window", name: "Review window", type: "BPMN_PROCESS", source: timerSource("Review window") },
  });
  expect(artifactResponse.status()).toBe(201);
  let artifact = (await artifactResponse.json()) as ArtifactResponse;

  const browserErrors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1440, height: 960 });
  await signInPage(page, `/studio/${artifact.data.id}`);
  await expect(page.locator(".djs-container")).toBeVisible();
  await page.locator('.djs-element[data-element-id="pause"] .djs-hit').click({ force: true });
  await expect(page.getByText("Let the process rest here, then continue automatically.")).toBeVisible();
  await expect(page.getByLabel("Duration")).toHaveValue("PT1H");
  await page.getByLabel("Duration").fill("PT12S");
  await page.getByRole("button", { name: "Apply pause" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("desktop-timer-studio.png"), fullPage: true });
  artifact = (await (await request.get(`/api/v1/artifacts/${artifact.data.id}`)).json()) as ArtifactResponse;
  expect(artifact.data.revision.source).toContain("bpmn:timeDuration");
  expect(artifact.data.revision.source).toContain("PT12S");

  const candidates = (await (await request.get(`/api/v1/artifacts/${artifact.data.id}/reviewers`)).json()) as ReviewerResponse;
  const reviewerId = seededReviewer(candidates.data).id;
  const reviewResponse = await request.post(`/api/v1/artifacts/${artifact.data.id}/reviews`, {
    data: { revisionId: artifact.data.revision.id, reviewerIds: [reviewerId], summary: "Durable timer contract" },
  });
  const review = (await reviewResponse.json()) as ReviewResponse;
  const reviewerRequest = await requestFactory.newContext({ baseURL: testInfo.project.use.baseURL });
  expect((await reviewerRequest.post("/api/auth/sign-in/email", { data: { ...reviewer, rememberMe: false } })).status()).toBe(200);
  expect((await reviewerRequest.post(`/api/v1/reviews/${review.data.id}/decision`, { data: { outcome: "APPROVED" } })).status()).toBe(200);
  await reviewerRequest.dispose();
  const publication = (await (await request.post(`/api/v1/reviews/${review.data.id}/publish`)).json()) as { data: { id: string } };
  const environments = (await (await request.get(`/api/v1/projects/${project.data.id}/environments`)).json()) as { data: Array<{ id: string; key: string }> };
  const deployment = (await (await request.post(`/api/v1/environments/${environments.data.find((environment) => environment.key === "development")!.id}/deploy`, {
    data: { publicationId: publication.data.id, note: "Timer acceptance" },
  })).json()) as { data: { id: string } };
  const startResponse = await request.post("/api/v1/process-instances", {
    data: { deploymentId: deployment.data.id, businessKey: `timer:${suffix}` },
  });
  expect(startResponse.status()).toBe(202);
  const started = (await startResponse.json()) as { data: { id: string } };
  let timerId = "";
  await expect.poll(async () => {
    const response = await request.get(`/api/v1/timers?instanceId=${started.data.id}`);
    const timers = (await response.json()) as { data: Array<{ id: string; expression: string; status: string }> };
    timerId = timers.data[0]?.id ?? "";
    return timers.data[0];
  }, { timeout: 10_000 }).toMatchObject({ expression: "PT12S", status: "WAITING" });
  const detailResponse = await request.get(`/api/v1/timers/${timerId}`);
  expect(detailResponse.status()).toBe(200);
  await expect(detailResponse.json()).resolves.toMatchObject({ data: { id: timerId, completionPending: false } });

  await page.goto(`/operations/${started.data.id}`);
  const timerStory = page.getByLabel("Durable timer");
  await expect(timerStory.getByText("PostgreSQL", { exact: true })).toBeVisible();
  await expect(timerStory.getByText("PT12S", { exact: true })).toBeVisible();
  await timerStory.screenshot({ path: testInfo.outputPath("desktop-durable-timer.png") });
  await expect.poll(async () => {
    const body = (await (await request.get(`/api/v1/process-instances/${started.data.id}`)).json()) as { data: { status: string; events: Array<{ type: string }> } };
    return body.data;
  }, { timeout: 20_000 }).toMatchObject({ status: "COMPLETED", events: expect.arrayContaining([
    expect.objectContaining({ type: "TIMER_SCHEDULED" }),
    expect.objectContaining({ type: "TIMER_FIRED" }),
  ]) });
  await page.reload();
  await expect(page.getByText("Review window is complete.")).toBeVisible();
  expect(browserErrors).toEqual([]);
});

test("message Studio, correlation API, and Operations share one exact durable contract", async ({ page, request }, testInfo) => {
  test.setTimeout(75_000);
  await signInApi(request);
  const library = (await (await request.get("/api/v1/library")).json()) as LibraryResponse;
  const suffix = Date.now().toString(36);
  const projectResponse = await request.post(`/api/v1/workspaces/${library.data.workspaces[0].id}/projects`, {
    data: { key: `messages-${suffix}`, name: "Durable messages acceptance" },
  });
  const project = (await projectResponse.json()) as { data: { id: string } };
  const artifactResponse = await request.post(`/api/v1/projects/${project.data.id}/artifacts`, {
    data: { key: "finance-answer", name: "Finance answer", type: "BPMN_PROCESS", source: messageSource("Finance answer") },
  });
  expect(artifactResponse.status()).toBe(201);
  let artifact = (await artifactResponse.json()) as ArtifactResponse;

  const browserErrors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1440, height: 960 });
  await signInPage(page, `/studio/${artifact.data.id}`);
  await expect(page.locator(".djs-container")).toBeVisible();
  await page.locator('.djs-element[data-element-id="listen"] .djs-hit').click({ force: true });
  await expect(page.getByText("Continue when another app sends a message for this exact case.")).toBeVisible();
  await expect(page.getByLabel("Message name")).toHaveValue("expense.approved");
  await expect(page.getByLabel("Match using")).toHaveValue("expenseId");
  await page.getByLabel("Message name").fill("expense.accepted");
  await page.getByLabel("Match using").fill("requestId");
  await page.getByRole("button", { name: "Apply contract" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("desktop-message-studio.png"), fullPage: true });
  artifact = (await (await request.get(`/api/v1/artifacts/${artifact.data.id}`)).json()) as ArtifactResponse;
  expect(artifact.data.revision.source).toContain('name="expense.accepted"');
  expect(artifact.data.revision.source).toContain('wanaflow:correlationKey="requestId"');
  expect(artifact.data.revision.source).toContain("bpmn:messageEventDefinition");

  const candidates = (await (await request.get(`/api/v1/artifacts/${artifact.data.id}/reviewers`)).json()) as ReviewerResponse;
  const reviewerId = seededReviewer(candidates.data).id;
  const reviewResponse = await request.post(`/api/v1/artifacts/${artifact.data.id}/reviews`, {
    data: { revisionId: artifact.data.revision.id, reviewerIds: [reviewerId], summary: "Durable message contract" },
  });
  const review = (await reviewResponse.json()) as ReviewResponse;
  const reviewerRequest = await requestFactory.newContext({ baseURL: testInfo.project.use.baseURL });
  expect((await reviewerRequest.post("/api/auth/sign-in/email", { data: { ...reviewer, rememberMe: false } })).status()).toBe(200);
  expect((await reviewerRequest.post(`/api/v1/reviews/${review.data.id}/decision`, { data: { outcome: "APPROVED" } })).status()).toBe(200);
  await reviewerRequest.dispose();
  const publication = (await (await request.post(`/api/v1/reviews/${review.data.id}/publish`)).json()) as { data: { id: string } };
  const environments = (await (await request.get(`/api/v1/projects/${project.data.id}/environments`)).json()) as { data: Array<{ id: string; key: string }> };
  const development = environments.data.find((environment) => environment.key === "development")!;
  const deployment = (await (await request.post(`/api/v1/environments/${development.id}/deploy`, {
    data: { publicationId: publication.data.id, note: "Message acceptance" },
  })).json()) as { data: { id: string } };
  const startResponse = await request.post("/api/v1/process-instances", {
    headers: { "Idempotency-Key": `message-start:${suffix}` },
    data: { deploymentId: deployment.data.id, businessKey: `message:${suffix}`, variables: { requestId: `REQ-${suffix}` } },
  });
  expect(startResponse.status()).toBe(202);
  const started = (await startResponse.json()) as { data: { id: string } };
  let subscriptionId = "";
  await expect.poll(async () => {
    const subscriptions = (await (await request.get(`/api/v1/message-subscriptions?instanceId=${started.data.id}`)).json()) as { data: Array<{ id: string; messageName: string; correlationKey: string; status: string }> };
    subscriptionId = subscriptions.data[0]?.id ?? "";
    return subscriptions.data[0];
  }, { timeout: 10_000 }).toMatchObject({ messageName: "expense.accepted", correlationKey: `REQ-${suffix}`, status: "WAITING" });
  expect((await request.get(`/api/v1/message-subscriptions/${subscriptionId}`)).status()).toBe(200);

  await page.goto(`/operations/${started.data.id}`);
  await expect(page.getByText("Wait for finance is listening.")).toBeVisible();
  const messageStory = page.getByLabel("Message subscription");
  await expect(messageStory.getByText("expense.accepted", { exact: true })).toBeVisible();
  await expect(messageStory.getByText(`REQ-${suffix}`, { exact: true })).toBeVisible();
  await messageStory.screenshot({ path: testInfo.outputPath("desktop-message-subscription.png") });

  const missingKey = await request.post("/api/v1/messages/correlate", {
    data: { environmentId: development.id, messageName: "expense.accepted", correlationKey: `REQ-${suffix}`, payload: {} },
  });
  expect(missingKey.status()).toBe(400);
  const noMatch = await request.post("/api/v1/messages/correlate", {
    headers: { "Idempotency-Key": `message-no-match:${suffix}` },
    data: { environmentId: development.id, messageName: "expense.accepted", correlationKey: "REQ-missing", payload: {} },
  });
  expect(noMatch.status()).toBe(200);
  await expect(noMatch.json()).resolves.toMatchObject({ data: { outcome: "NO_MATCH", commandId: null } });
  const correlation = await request.post("/api/v1/messages/correlate", {
    headers: { "Idempotency-Key": `message-match:${suffix}` },
    data: { environmentId: development.id, messageName: "expense.accepted", correlationKey: `REQ-${suffix}`, payload: { approvalRef: `APP-${suffix}` } },
  });
  expect(correlation.status()).toBe(202);
  await expect(correlation.json()).resolves.toMatchObject({ data: { outcome: "CORRELATED", commandId: expect.any(String) } });
  await expect.poll(async () => {
    const detail = (await (await request.get(`/api/v1/process-instances/${started.data.id}`)).json()) as { data: { status: string; variables: Record<string, unknown>; events: Array<{ type: string }> } };
    return detail.data;
  }, { timeout: 10_000 }).toMatchObject({
    status: "COMPLETED",
    variables: { requestId: `REQ-${suffix}`, approvalRef: `APP-${suffix}` },
    events: expect.arrayContaining([
      expect.objectContaining({ type: "MESSAGE_SUBSCRIBED" }),
      expect.objectContaining({ type: "MESSAGE_CORRELATED" }),
    ]),
  });
  await page.reload();
  await expect(page.getByText("Finance answer is complete.")).toBeVisible();
  expect(browserErrors).toEqual([]);
});

test("message throw Studio and Operations explain transactional outbound delivery", async ({ page, request }, testInfo) => {
  test.setTimeout(75_000);
  await signInApi(request);
  const library = (await (await request.get("/api/v1/library")).json()) as LibraryResponse;
  const suffix = Date.now().toString(36);
  const project = (await (await request.post(`/api/v1/workspaces/${library.data.workspaces[0].id}/projects`, {
    data: { key: `message-send-${suffix}`, name: "Outbound message acceptance" },
  })).json()) as { data: { id: string } };
  const artifactResponse = await request.post(`/api/v1/projects/${project.data.id}/artifacts`, {
    data: { key: "finance-notice", name: "Finance notice", type: "BPMN_PROCESS", source: messageThrowSource("Finance notice") },
  });
  expect(artifactResponse.status()).toBe(201);
  let artifact = (await artifactResponse.json()) as ArtifactResponse;

  const browserErrors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1440, height: 960 });
  await signInPage(page, `/studio/${artifact.data.id}`);
  await expect(page.locator(".djs-container")).toBeVisible();
  await page.locator('.djs-element[data-element-id="send"] .djs-hit').click({ force: true });
  await expect(page.getByText("Tell another process or app that this moment happened.")).toBeVisible();
  await page.getByLabel("Message name").fill("expense.notified");
  await page.getByLabel("Identify the case with").fill("requestId");
  await page.getByText("Payload", { exact: true }).click();
  await page.getByLabel("Payload mapping").fill("approvalCode = approvalRef");
  await page.getByRole("button", { name: "Apply message" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("desktop-message-throw-studio.png"), fullPage: true });
  artifact = (await (await request.get(`/api/v1/artifacts/${artifact.data.id}`)).json()) as ArtifactResponse;
  expect(artifact.data.revision.source).toContain('name="expense.notified"');
  expect(artifact.data.revision.source).toContain('wanaflow:correlationKey="requestId"');
  expect(artifact.data.revision.source).toContain("approvalCode");

  const candidates = (await (await request.get(`/api/v1/artifacts/${artifact.data.id}/reviewers`)).json()) as ReviewerResponse;
  const review = (await (await request.post(`/api/v1/artifacts/${artifact.data.id}/reviews`, {
    data: {
      revisionId: artifact.data.revision.id,
      reviewerIds: [seededReviewer(candidates.data).id],
      summary: "Outbound message contract",
    },
  })).json()) as ReviewResponse;
  const reviewerRequest = await requestFactory.newContext({ baseURL: testInfo.project.use.baseURL });
  expect((await reviewerRequest.post("/api/auth/sign-in/email", { data: { ...reviewer, rememberMe: false } })).status()).toBe(200);
  expect((await reviewerRequest.post(`/api/v1/reviews/${review.data.id}/decision`, { data: { outcome: "APPROVED" } })).status()).toBe(200);
  await reviewerRequest.dispose();
  const publication = (await (await request.post(`/api/v1/reviews/${review.data.id}/publish`)).json()) as { data: { id: string } };
  const environments = (await (await request.get(`/api/v1/projects/${project.data.id}/environments`)).json()) as { data: Array<{ id: string; key: string }> };
  const deployment = (await (await request.post(`/api/v1/environments/${environments.data.find((environment) => environment.key === "development")!.id}/deploy`, {
    data: { publicationId: publication.data.id, note: "Outbound message acceptance" },
  })).json()) as { data: { id: string } };
  const started = (await (await request.post("/api/v1/process-instances", {
    data: {
      deploymentId: deployment.data.id,
      businessKey: `message-send:${suffix}`,
      variables: { requestId: `REQ-${suffix}`, approvalRef: `APP-${suffix}` },
    },
  })).json()) as { data: { id: string } };

  let deliveryId = "";
  await expect.poll(async () => {
    const deliveries = (await (await request.get(`/api/v1/message-deliveries?instanceId=${started.data.id}`)).json()) as { data: Array<{ id: string; status: string; messageName: string; correlationKey: string; payload: Record<string, unknown> }> };
    deliveryId = deliveries.data[0]?.id ?? "";
    return deliveries.data[0];
  }, { timeout: 10_000 }).toMatchObject({
    status: "NO_MATCH",
    messageName: "expense.notified",
    correlationKey: `REQ-${suffix}`,
    payload: { approvalCode: `APP-${suffix}` },
  });
  expect((await request.get(`/api/v1/message-deliveries/${deliveryId}`)).status()).toBe(200);

  await page.goto(`/operations/${started.data.id}`);
  const deliveryStory = page.getByLabel("Outbound message delivery");
  await expect(deliveryStory.getByText("No listener found", { exact: true })).toBeVisible();
  await expect(deliveryStory.getByText("expense.notified", { exact: true })).toBeVisible();
  await deliveryStory.screenshot({ path: testInfo.outputPath("desktop-message-delivery-no-match.png") });
  expect(browserErrors).toEqual([]);
});

test("desktop sign-in, library, Studio, and work surfaces respond", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  const browserErrors = collectBrowserErrors(page);
  await page.goto("/sign-in?next=//example.com");
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password").fill(owner.password);
  await page.getByRole("button", { name: "Enter Wanaflow" }).click();
  await expect(page).toHaveURL("http://127.0.0.1:3100/");
  await page.goto("/library");

  await page.getByRole("button", { name: "New" }).click();
  await page.getByRole("button", { name: "Blank process" }).click();
  await page.getByLabel("Name").fill("Travel request");
  await expect(page.getByLabel("Stable key")).toHaveValue("travel-request");
  await page.getByRole("button", { name: "Create and open" }).click();
  await expect(page).toHaveURL(/\/studio\/[0-9a-f-]+$/);
  await expect(page.locator(".djs-container")).toBeVisible();
  await expect(page.getByText("Travel request", { exact: true }).first()).toBeVisible();

  for (const [route, expectedText] of routes) {
    await page.goto(route);
    await expect(page.getByText(expectedText, { exact: false }).first()).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`desktop-${route.slice(1) || "home"}.png`),
      fullPage: true,
    });
  }

  await page.goto("/library");
  await expect(page.getByRole("link", { name: /Travel request/ })).toBeVisible();
  await page.getByRole("link", { name: /Employee onboarding/ }).click();
  await expect(page.locator(".djs-container")).toBeVisible();
  await page.locator('.djs-element[data-element-id="Task_ProvisionEquipment"] .djs-hit').click();
  await expect(page.getByText("Worker job", { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("invoice.send")).toHaveValue("equipment.provision");
  await page.getByText("Payload & delivery", { exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("desktop-studio-worker-job.png"), fullPage: true });
  await page.getByRole("button", { name: "Close inspector" }).click();
  const task = page.locator('.djs-element[data-element-id="Task_CollectDetails"] .djs-visual');
  const taskBox = await task.boundingBox();
  expect(taskBox).not.toBeNull();
  if (taskBox) {
    await page.mouse.move(taskBox.x + taskBox.width / 2, taskBox.y + taskBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(taskBox.x + taskBox.width / 2 + 24, taskBox.y + taskBox.height / 2, {
      steps: 8,
    });
    await page.mouse.up();
  }
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  await expect(page.getByText("Revision 2 · PostgreSQL")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Draft revision 2")).toBeVisible();
  await page.getByRole("button", { name: "Request review" }).click();
  await expect(page.getByRole("dialog", { name: "Invite careful eyes." })).toBeVisible();
  await expect(page.getByText("Moussa Diop", { exact: true })).toBeVisible();
  const assignedReviewers = page.getByRole("group", { name: "Assigned reviewers" });
  await assignedReviewers.getByRole("checkbox", { name: /Moussa Diop/ }).check();
  const invitedReviewer = assignedReviewers.getByRole("checkbox", { name: /Aminata Fall/ });
  if (await invitedReviewer.count()) await invitedReviewer.uncheck();
  await page.getByLabel("Review brief").fill("Check the equipment handoff and approval order.");
  await page.getByRole("button", { name: "Send for review" }).click();
  const requestedReviewLink = page.getByRole("link", { name: "Review requested" });
  await expect(requestedReviewLink).toBeVisible();
  const requestedReviewPath = await requestedReviewLink.getAttribute("href");
  expect(requestedReviewPath).toMatch(/^\/reviews\/[0-9a-f-]+$/);

  await page.getByRole("button", { name: "Open Awa Wane account menu" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await signInPage(page, requestedReviewPath!, reviewer);

  await expect(page.locator(".djs-container")).toBeVisible();
  await expect(page.getByText("Check the equipment handoff and approval order.")).toBeVisible();
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await page.getByLabel("Review comment").fill("Please confirm the equipment handoff is explicit.");
  await page.getByRole("button", { name: "Add anchored comment" }).click();
  await expect(page.getByText("Please confirm the equipment handoff is explicit.")).toBeVisible();
  await page.getByRole("button", { name: "Resolve" }).click();
  await expect(page.getByText("Resolved")).toBeVisible();
  await page.getByRole("button", { name: "Approve", exact: true }).first().click();
  await page.getByRole("button", { name: "Record approval" }).click();
  await expect(page.getByText("Eligible for publication")).toBeVisible();
  await expect(page.getByText("approved the revision")).toBeVisible();

  await page.getByRole("button", { name: "Open Moussa Diop account menu" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await signInPage(page, requestedReviewPath!);
  await page.getByRole("button", { name: "Create publication" }).click();
  await expect(page.getByRole("dialog", { name: /Seal revision 2 for release/ })).toBeVisible();
  await page.getByRole("button", { name: "Create immutable publication" }).click();
  await expect(page.getByText("The approved source is sealed.")).toBeVisible();
  await expect(page.getByText("Publication · v1")).toBeVisible();
  await page.getByRole("button", { name: "Deploy", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Place publication v1." })).toBeVisible();
  await page.getByLabel(/Staging/).check();
  await page.getByLabel("Release note").fill("QA-approved release candidate.");
  await page.getByRole("button", { name: "Create deployment" }).click();
  await expect(page.getByRole("dialog", { name: "Start the first durable instance." })).toBeVisible();
  await page.getByRole("button", { name: "Later" }).click();
  await expect(page.getByText("1 immutable deployment")).toBeVisible();
  await expect(page.getByText("created an immutable deployment")).toBeVisible();

  await page.goto("/inbox");
  await expect(page.getByRole("heading", { name: "My work" })).toBeVisible();

  await page.goto("/operations");
  await expect(page.getByText("Instances")).toBeVisible();

  await page.goto("/");
  await page.getByRole("button", { name: "Open command palette" }).click();
  await expect(page.getByPlaceholder("Find a process, task, review, or command…")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Open Awa Wane account menu" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  expect(browserErrors).toEqual([]);
});

test("DMN Studio creates a bounded decision table without exposing an admin surface", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  const browserErrors = collectBrowserErrors(page);
  await signInPage(page, "/library");
  await page.getByRole("button", { name: "New" }).click();
  await page.getByRole("button", { name: "Blank decision" }).click();
  await page.getByLabel("Name").fill("Invoice routing");
  await expect(page.getByLabel("Stable key")).toHaveValue("invoice-routing");
  await page.getByRole("button", { name: "Create decision" }).click();
  await expect(page).toHaveURL(/\/decisions\/[0-9a-f-]+$/);
  await expect(page.getByLabel("DMN decision table")).toBeVisible();
  await expect(page.locator(".tjs-container")).toBeVisible();
  await expect(page.getByText("Make the rule readable first.")).toBeVisible();
  await expect(page.getByText("UNIQUE", { exact: true }).last()).toBeVisible();
  await expect(page.getByRole("button", { name: "Request review" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("desktop-dmn-studio.png"), fullPage: true });
  expect(browserErrors).toEqual([]);
});

test("a business starter story opens in Studio and previews without deployment", async ({ page }, testInfo) => {
  test.setTimeout(75_000);
  await page.setViewportSize({ width: 1440, height: 960 });
  const browserErrors = collectBrowserErrors(page);
  const suffix = Date.now().toString(36);

  await signInPage(page);
  await page.goto("/library?start=templates");
  await expect(page.getByRole("dialog", { name: "Choose a starter story" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Request and approval/ })).toBeVisible();
  await page.getByLabel("Name").fill(`Travel approval ${suffix}`);
  await expect(page.getByLabel("Stable key")).toHaveValue(`travel-approval-${suffix}`);
  await page.getByRole("button", { name: "Use this story" }).click();

  await expect(page).toHaveURL(/\/studio\/[0-9a-f-]+$/);
  await expect(page.locator(".djs-container")).toBeVisible();
  await expect(page.getByText("Just you", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Test" }).click();
  await expect(page.getByRole("dialog", { name: "Walk through this draft." })).toBeVisible();
  await expect(page.getByText("Nothing is deployed, assigned, or written to Operations.")).toBeVisible();
  await page.getByRole("button", { name: "Begin preview" }).click();
  await expect(page.getByText("Prepare request", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Paused · user task", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue path" }).click();
  await expect(page.getByText("Review request", { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("desktop-starter-safe-preview.png"), fullPage: true });

  expect(browserErrors).toEqual([]);
});

test("mobile priority workflows remain inside the viewport", async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const browserErrors = collectBrowserErrors(page);
  await signInPage(page);

  for (const [route, expectedText] of routes) {
    await page.goto(route);
    await expect(page.getByText(expectedText, { exact: false }).first()).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
    await page.screenshot({
      path: testInfo.outputPath(`mobile-${route.slice(1) || "home"}.png`),
      fullPage: true,
    });
  }

  await page.goto("/inbox");
  const taskHeading = page.getByRole("heading", { name: "My work" });
  await expect(taskHeading).toBeVisible();
  const taskHeadingBox = await taskHeading.boundingBox();
  expect(taskHeadingBox).not.toBeNull();
  expect(taskHeadingBox?.x).toBeLessThanOrEqual(40);

  await signInApi(request);
  const library = (await (await request.get("/api/v1/library")).json()) as LibraryResponse;
  const suffix = Date.now().toString(36);
  const formResponse = await request.post(`/api/v1/projects/${library.data.workspaces[0].projects[0].id}/artifacts`, {
    data: { key: `mobile-form-${suffix}`, name: "Mobile form QA", type: "FORM", source: portableFormSource("Mobile form QA") },
  });
  const form = (await formResponse.json()) as ArtifactResponse;
  await page.goto(`/forms/${form.data.id}`);
  await expect(page.getByText("Continue on a larger screen.")).toBeVisible();
  const formDimensions = await page.evaluate(() => ({ documentWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth }));
  expect(formDimensions.documentWidth).toBeLessThanOrEqual(formDimensions.viewportWidth + 1);
  await page.screenshot({ path: testInfo.outputPath("mobile-form-studio.png"), fullPage: true });

  expect(browserErrors).toEqual([]);
});

test("two designers share live Studio presence and remote revisions", async ({ browser, request }, testInfo) => {
  test.setTimeout(75_000);
  await signInApi(request);
  const library = (await (await request.get("/api/v1/library")).json()) as LibraryResponse;
  const workspace = library.data.workspaces[0];
  const sample = workspace.projects.flatMap((project) => project.artifacts).find((artifact) => artifact.key === "employee-onboarding");
  expect(sample).toBeTruthy();

  const suffix = Date.now().toString(36);
  const collaborator = {
    email: `designer-${suffix}@wanaflow.test`,
    password: "Wanaflow-designer-test-2026!",
  };
  const invitationResponse = await request.post("/api/v1/invitations", {
    data: {
      workspaceId: workspace.id,
      email: collaborator.email,
      displayName: "Fatou Ndiaye",
      role: "designer",
    },
  });
  expect(invitationResponse.status()).toBe(201);
  const invitation = (await invitationResponse.json()) as { data: { acceptUrl: string } };
  const studioPath = `/studio/${sample!.id}`;

  const ownerContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const collaboratorContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const ownerPage = await ownerContext.newPage();
  const collaboratorPage = await collaboratorContext.newPage();
  const ownerErrors = collectBrowserErrors(ownerPage);
  const collaboratorErrors = collectBrowserErrors(collaboratorPage);

  try {
    await collaboratorPage.goto(invitation.data.acceptUrl);
    await collaboratorPage.getByLabel("Choose a password").fill(collaborator.password);
    await collaboratorPage.getByRole("button", { name: "Join the workspace" }).click();
    await expect(collaboratorPage.getByRole("heading", { name: "Your workspace is waiting." })).toBeVisible();

    await signInPage(ownerPage, studioPath);
    await signInPage(collaboratorPage, studioPath, collaborator);
    await expect(ownerPage.locator(".djs-container")).toBeVisible();
    await expect(collaboratorPage.locator(".djs-container")).toBeVisible();
    await expect(ownerPage.getByLabel("2 editing in this draft")).toBeVisible({ timeout: 8_000 });

    const ownerCanvas = await ownerPage.locator(".bpmn-surface").boundingBox();
    expect(ownerCanvas).not.toBeNull();
    if (ownerCanvas) await ownerPage.mouse.move(ownerCanvas.x + ownerCanvas.width * 0.45, ownerCanvas.y + ownerCanvas.height * 0.35);
    await expect(collaboratorPage.locator('[data-collaborator-cursor="Awa Wane"]')).toBeVisible({ timeout: 8_000 });
    await expect(collaboratorPage.locator(".wanaflow-collaborator-selected").first()).toBeVisible({ timeout: 8_000 });

    const task = ownerPage.locator('.djs-element[data-element-id="Task_CollectDetails"] .djs-visual');
    const taskBox = await task.boundingBox();
    expect(taskBox).not.toBeNull();
    if (taskBox) {
      await ownerPage.mouse.move(taskBox.x + taskBox.width / 2, taskBox.y + taskBox.height / 2);
      await ownerPage.mouse.down();
      await ownerPage.mouse.move(taskBox.x + taskBox.width / 2 + 20, taskBox.y + taskBox.height / 2, { steps: 6 });
      await ownerPage.mouse.up();
    }
    await expect(ownerPage.getByText("Unsaved changes")).toBeVisible();
    await ownerPage.getByRole("button", { name: "Save", exact: true }).click();
    await expect(ownerPage.getByText("All changes saved")).toBeVisible();
    const sharedRevision = await ownerPage.getByText(/BPMN · Draft revision \d+/).first().textContent();
    expect(sharedRevision).toBeTruthy();
    await expect(collaboratorPage.getByText(sharedRevision!, { exact: true })).toBeVisible({ timeout: 10_000 });
    await collaboratorPage.screenshot({ path: testInfo.outputPath("two-user-live-studio.png"), fullPage: true });

    await collaboratorContext.setOffline(true);
    const collaboratorTask = collaboratorPage.locator('.djs-element[data-element-id="Task_CollectDetails"] .djs-visual');
    const collaboratorTaskBox = await collaboratorTask.boundingBox();
    expect(collaboratorTaskBox).not.toBeNull();
    if (collaboratorTaskBox) {
      await collaboratorPage.mouse.move(collaboratorTaskBox.x + collaboratorTaskBox.width / 2, collaboratorTaskBox.y + collaboratorTaskBox.height / 2);
      await collaboratorPage.mouse.down();
      await collaboratorPage.mouse.move(collaboratorTaskBox.x + collaboratorTaskBox.width / 2, collaboratorTaskBox.y + collaboratorTaskBox.height / 2 + 18, { steps: 6 });
      await collaboratorPage.mouse.up();
    }
    await expect(collaboratorPage.getByText("Unsaved changes")).toBeVisible();
    await expect(collaboratorPage.getByLabel("Offline in this draft")).toBeVisible();

    const ownerSecondTask = ownerPage.locator('.djs-element[data-element-id="Task_ProvisionEquipment"] .djs-visual');
    const ownerSecondTaskBox = await ownerSecondTask.boundingBox();
    expect(ownerSecondTaskBox).not.toBeNull();
    if (ownerSecondTaskBox) {
      await ownerPage.mouse.move(ownerSecondTaskBox.x + ownerSecondTaskBox.width / 2, ownerSecondTaskBox.y + ownerSecondTaskBox.height / 2);
      await ownerPage.mouse.down();
      await ownerPage.mouse.move(ownerSecondTaskBox.x + ownerSecondTaskBox.width / 2 + 18, ownerSecondTaskBox.y + ownerSecondTaskBox.height / 2, { steps: 6 });
      await ownerPage.mouse.up();
    }
    await expect(ownerPage.getByText("Unsaved changes")).toBeVisible();
    await ownerPage.getByRole("button", { name: "Save", exact: true }).click();
    await expect(ownerPage.getByText("All changes saved")).toBeVisible();
    const newestRevision = await ownerPage.getByText(/BPMN · Draft revision \d+/).first().textContent();
    expect(newestRevision).toBeTruthy();

    await collaboratorContext.setOffline(false);
    const recovery = collaboratorPage.getByRole("region", { name: "Draft recovery" });
    await expect(recovery.getByText("Two drafts, both safe")).toBeVisible({ timeout: 8_000 });
    await expect(recovery.getByRole("button", { name: "Use shared draft" })).toBeVisible();
    await expect(recovery.getByRole("button", { name: "Keep my copy as latest" })).toBeVisible();
    await recovery.getByRole("button", { name: "Use shared draft" }).click();
    await expect(collaboratorPage.getByText(newestRevision!, { exact: true })).toBeVisible({ timeout: 8_000 });
    await collaboratorPage.screenshot({ path: testInfo.outputPath("two-user-conflict-recovered.png"), fullPage: true });

    expect(ownerErrors).toEqual([]);
    expect(collaboratorErrors).toEqual([]);
  } finally {
    await ownerContext.close();
    await collaboratorContext.close();
  }
});
