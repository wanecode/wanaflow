import { bootstrapFirstOwner, closePool, getPool } from "@wanaflow/db";

import { employeeOnboardingBpmn } from "../lib/sample-process";

function configurationValue(name: string, developmentFallback: string) {
  const value = process.env[name];
  if (value) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error(`${name} is required for the production owner bootstrap.`);
  }
  return developmentFallback;
}

async function run() {
  const configured = await getPool().query(
    `SELECT 1
     FROM organization_memberships m
     JOIN principals p ON p.id = m.principal_id AND p.organization_id = m.organization_id
     WHERE p.auth_user_id IS NOT NULL
     LIMIT 1`,
  );
  if (configured.rowCount) {
    console.info("Wanaflow already has an authenticated organization owner; bootstrap skipped.");
    return;
  }

  const email = configurationValue("WANAFLOW_BOOTSTRAP_EMAIL", "local@wanaflow.dev").toLowerCase();
  const password = configurationValue("WANAFLOW_BOOTSTRAP_PASSWORD", "Wanaflow-local-2026!");
  const displayName = configurationValue("WANAFLOW_BOOTSTRAP_NAME", "Mariama Wane");

  process.env.WANAFLOW_BOOTSTRAP_MODE = "true";
  const { auth } = await import("../lib/auth");

  const existingUser = await getPool().query<{ id: string }>(
    `SELECT id FROM "user" WHERE lower(email) = lower($1)`,
    [email],
  );
  const authUserId = existingUser.rows[0]?.id ?? (
    await auth.api.signUpEmail({ body: { email, password, name: displayName } })
  ).user.id;

  const setup = await bootstrapFirstOwner({
    authUserId,
    email,
    displayName,
    organizationKey: process.env.WANAFLOW_BOOTSTRAP_ORGANIZATION_KEY ?? "local",
    organizationName: process.env.WANAFLOW_BOOTSTRAP_ORGANIZATION_NAME ?? "Wanaflow local",
    workspaceKey: process.env.WANAFLOW_BOOTSTRAP_WORKSPACE_KEY ?? "default",
    projectKey: process.env.WANAFLOW_BOOTSTRAP_PROJECT_KEY ?? "people-operations",
    artifactSource: employeeOnboardingBpmn,
  });

  const reviewerEmail =
    process.env.WANAFLOW_BOOTSTRAP_REVIEWER_EMAIL ??
    (process.env.NODE_ENV === "production" ? null : "reviewer@wanaflow.dev");
  if (reviewerEmail) {
    const reviewerName = configurationValue("WANAFLOW_BOOTSTRAP_REVIEWER_NAME", "Moussa Diop");
    const reviewerPassword = configurationValue(
      "WANAFLOW_BOOTSTRAP_REVIEWER_PASSWORD",
      "Wanaflow-reviewer-2026!",
    );
    const normalizedEmail = reviewerEmail.toLowerCase();
    const existingReviewer = await getPool().query<{ id: string }>(
      `SELECT id FROM "user" WHERE lower(email) = lower($1)`,
      [normalizedEmail],
    );
    const reviewerAuthUserId = existingReviewer.rows[0]?.id ?? (
      await auth.api.signUpEmail({
        body: { email: normalizedEmail, password: reviewerPassword, name: reviewerName },
      })
    ).user.id;
    const reviewer = await getPool().query<{ id: string }>(
      `INSERT INTO principals
        (organization_id, auth_user_id, email, display_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (organization_id, auth_user_id) WHERE auth_user_id IS NOT NULL
       DO UPDATE SET email = EXCLUDED.email, display_name = EXCLUDED.display_name
       RETURNING id`,
      [setup.organization.id, reviewerAuthUserId, normalizedEmail, reviewerName],
    );
    await getPool().query(
      `INSERT INTO organization_memberships
        (organization_id, principal_id, role)
       VALUES ($1, $2, 'reviewer')
       ON CONFLICT (organization_id, principal_id) WHERE workspace_id IS NULL DO NOTHING`,
      [setup.organization.id, reviewer.rows[0].id],
    );
    console.info(`Created the independent reviewer ${reviewerName} (${normalizedEmail}).`);
  }

  console.info(`Created the first Wanaflow owner for ${setup.organization.name} (${email}).`);
}

run()
  .then(() => closePool())
  .catch(async (error: unknown) => {
    console.error(error);
    await closePool();
    process.exitCode = 1;
  });
