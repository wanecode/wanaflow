export type Migration = {
  id: string;
  sql: string;
};

export const migrations: Migration[] = [
  {
    id: "0001_artifact_registry",
    sql: `
      CREATE EXTENSION IF NOT EXISTS pgcrypto;

      CREATE TYPE artifact_type AS ENUM ('BPMN_PROCESS', 'DMN_DECISION', 'FORM');

      CREATE TABLE organizations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        key text NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9-]{1,62}$'),
        name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE workspaces (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id),
        key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9-]{1,62}$'),
        name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (organization_id, key),
        UNIQUE (id, organization_id)
      );

      CREATE TABLE principals (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id),
        email text NOT NULL,
        display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (organization_id, email),
        UNIQUE (id, organization_id)
      );

      CREATE TABLE projects (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id),
        workspace_id uuid NOT NULL,
        key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9-]{1,62}$'),
        name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (organization_id, workspace_id, key),
        UNIQUE (id, organization_id),
        FOREIGN KEY (workspace_id, organization_id) REFERENCES workspaces(id, organization_id)
      );

      CREATE TABLE artifacts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id),
        project_id uuid NOT NULL,
        key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9-]{1,62}$'),
        name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
        type artifact_type NOT NULL,
        draft_head_revision_id uuid,
        next_revision_number integer NOT NULL DEFAULT 1 CHECK (next_revision_number > 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (organization_id, project_id, key),
        UNIQUE (id, organization_id),
        FOREIGN KEY (project_id, organization_id) REFERENCES projects(id, organization_id)
      );

      CREATE TABLE artifact_revisions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id),
        artifact_id uuid NOT NULL,
        number integer NOT NULL CHECK (number > 0),
        source text NOT NULL CHECK (octet_length(source) > 0 AND octet_length(source) <= 2097152),
        content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
        validation_status text NOT NULL CHECK (validation_status IN ('VALID', 'INVALID')),
        validation jsonb NOT NULL,
        created_by uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (artifact_id, number),
        UNIQUE (artifact_id, content_sha256),
        UNIQUE (id, artifact_id),
        FOREIGN KEY (artifact_id, organization_id) REFERENCES artifacts(id, organization_id),
        FOREIGN KEY (created_by, organization_id) REFERENCES principals(id, organization_id)
      );

      ALTER TABLE artifacts
        ADD CONSTRAINT artifacts_draft_head_fk
        FOREIGN KEY (draft_head_revision_id, id)
        REFERENCES artifact_revisions(id, artifact_id)
        DEFERRABLE INITIALLY DEFERRED;

      CREATE TABLE audit_records (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id),
        actor_id uuid NOT NULL,
        action text NOT NULL,
        resource_type text NOT NULL,
        resource_id uuid NOT NULL,
        details jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (actor_id, organization_id) REFERENCES principals(id, organization_id)
      );

      CREATE TABLE outbox_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id),
        type text NOT NULL,
        aggregate_type text NOT NULL,
        aggregate_id uuid NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        published_at timestamptz
      );

      CREATE INDEX artifact_revisions_artifact_created_idx
        ON artifact_revisions (artifact_id, created_at DESC);
      CREATE INDEX audit_records_resource_idx
        ON audit_records (organization_id, resource_type, resource_id, created_at DESC);
      CREATE INDEX outbox_events_unpublished_idx
        ON outbox_events (created_at) WHERE published_at IS NULL;

      CREATE FUNCTION prevent_artifact_revision_update() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'artifact revisions are immutable';
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER artifact_revisions_no_update
        BEFORE UPDATE ON artifact_revisions
        FOR EACH ROW EXECUTE FUNCTION prevent_artifact_revision_update();
    `,
  },
  {
    id: "0002_better_auth_core",
    sql: `
      CREATE TABLE "user" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" text NOT NULL,
        "email" text NOT NULL UNIQUE,
        "emailVerified" boolean NOT NULL,
        "image" text,
        "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE "session" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "expiresAt" timestamptz NOT NULL,
        "token" text NOT NULL UNIQUE,
        "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" timestamptz NOT NULL,
        "ipAddress" text,
        "userAgent" text,
        "userId" uuid NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE
      );

      CREATE TABLE "account" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "accountId" text NOT NULL,
        "providerId" text NOT NULL,
        "userId" uuid NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
        "accessToken" text,
        "refreshToken" text,
        "idToken" text,
        "accessTokenExpiresAt" timestamptz,
        "refreshTokenExpiresAt" timestamptz,
        "scope" text,
        "password" text,
        "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" timestamptz NOT NULL
      );

      CREATE TABLE "verification" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "identifier" text NOT NULL,
        "value" text NOT NULL,
        "expiresAt" timestamptz NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX "session_userId_idx" ON "session" ("userId");
      CREATE INDEX "account_userId_idx" ON "account" ("userId");
      CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");
    `,
  },
  {
    id: "0003_tenant_memberships",
    sql: `
      ALTER TABLE principals
        ADD COLUMN auth_user_id uuid REFERENCES "user" ("id") ON DELETE RESTRICT;

      CREATE UNIQUE INDEX principals_auth_user_organization_idx
        ON principals (organization_id, auth_user_id)
        WHERE auth_user_id IS NOT NULL;

      CREATE TABLE organization_memberships (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        principal_id uuid NOT NULL,
        workspace_id uuid,
        role text NOT NULL CHECK (role IN (
          'organization-owner',
          'workspace-admin',
          'designer',
          'reviewer',
          'operator',
          'task-worker'
        )),
        created_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (principal_id, organization_id)
          REFERENCES principals(id, organization_id) ON DELETE CASCADE,
        FOREIGN KEY (workspace_id, organization_id)
          REFERENCES workspaces(id, organization_id) ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX organization_memberships_organization_principal_idx
        ON organization_memberships (organization_id, principal_id)
        WHERE workspace_id IS NULL;
      CREATE UNIQUE INDEX organization_memberships_workspace_principal_idx
        ON organization_memberships (organization_id, workspace_id, principal_id)
        WHERE workspace_id IS NOT NULL;
      CREATE INDEX organization_memberships_auth_lookup_idx
        ON organization_memberships (organization_id, principal_id, role);
    `,
  },
  {
    id: "0004_revision_reviews",
    sql: `
      CREATE TABLE reviews (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        project_id uuid NOT NULL,
        artifact_id uuid NOT NULL,
        revision_id uuid NOT NULL,
        status text NOT NULL DEFAULT 'OPEN' CHECK (status IN (
          'OPEN', 'APPROVED', 'CHANGES_REQUESTED', 'CANCELLED'
        )),
        summary text NOT NULL DEFAULT '' CHECK (char_length(summary) <= 2000),
        requested_by uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        decided_at timestamptz,
        cancelled_at timestamptz,
        UNIQUE (artifact_id, revision_id),
        UNIQUE (id, organization_id),
        FOREIGN KEY (project_id, organization_id) REFERENCES projects(id, organization_id),
        FOREIGN KEY (artifact_id, organization_id) REFERENCES artifacts(id, organization_id),
        FOREIGN KEY (revision_id, artifact_id) REFERENCES artifact_revisions(id, artifact_id),
        FOREIGN KEY (requested_by, organization_id) REFERENCES principals(id, organization_id),
        CHECK ((status IN ('APPROVED', 'CHANGES_REQUESTED')) = (decided_at IS NOT NULL)),
        CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL))
      );

      CREATE INDEX reviews_project_status_created_idx
        ON reviews (organization_id, project_id, status, created_at DESC);
      CREATE INDEX reviews_revision_idx
        ON reviews (revision_id, status);

      CREATE TABLE review_assignments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        review_id uuid NOT NULL,
        principal_id uuid NOT NULL,
        assigned_by uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (review_id, principal_id),
        FOREIGN KEY (review_id, organization_id) REFERENCES reviews(id, organization_id) ON DELETE CASCADE,
        FOREIGN KEY (principal_id, organization_id) REFERENCES principals(id, organization_id),
        FOREIGN KEY (assigned_by, organization_id) REFERENCES principals(id, organization_id)
      );

      CREATE INDEX review_assignments_principal_idx
        ON review_assignments (organization_id, principal_id, created_at DESC);

      CREATE TABLE review_comments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        review_id uuid NOT NULL,
        element_id text NOT NULL CHECK (element_id ~ '^[A-Za-z_][A-Za-z0-9_.:-]{0,254}$'),
        element_name text NOT NULL CHECK (char_length(element_name) BETWEEN 1 AND 255),
        body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
        created_by uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        resolved_at timestamptz,
        resolved_by uuid,
        UNIQUE (id, review_id),
        FOREIGN KEY (review_id, organization_id) REFERENCES reviews(id, organization_id) ON DELETE CASCADE,
        FOREIGN KEY (created_by, organization_id) REFERENCES principals(id, organization_id),
        FOREIGN KEY (resolved_by, organization_id) REFERENCES principals(id, organization_id),
        CHECK ((resolved_at IS NULL) = (resolved_by IS NULL))
      );

      CREATE INDEX review_comments_review_created_idx
        ON review_comments (review_id, created_at ASC);
      CREATE INDEX review_comments_open_idx
        ON review_comments (review_id) WHERE resolved_at IS NULL;

      CREATE TABLE review_decisions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        review_id uuid NOT NULL UNIQUE,
        outcome text NOT NULL CHECK (outcome IN ('APPROVED', 'CHANGES_REQUESTED')),
        note text CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 4000),
        decided_by uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (review_id, organization_id) REFERENCES reviews(id, organization_id),
        FOREIGN KEY (decided_by, organization_id) REFERENCES principals(id, organization_id)
      );

      CREATE VIEW publication_eligible_revisions AS
        SELECT DISTINCT
          r.organization_id,
          r.artifact_id,
          r.revision_id,
          r.id AS review_id,
          r.decided_at AS eligible_at
        FROM reviews r
        JOIN artifact_revisions ar
          ON ar.id = r.revision_id AND ar.artifact_id = r.artifact_id
        WHERE r.status = 'APPROVED' AND ar.validation_status = 'VALID';

      CREATE FUNCTION enforce_review_pinning_and_terminal_state() RETURNS trigger AS $$
      BEGIN
        IF NEW.organization_id <> OLD.organization_id
          OR NEW.project_id <> OLD.project_id
          OR NEW.artifact_id <> OLD.artifact_id
          OR NEW.revision_id <> OLD.revision_id
          OR NEW.summary <> OLD.summary
          OR NEW.requested_by <> OLD.requested_by
          OR NEW.created_at <> OLD.created_at THEN
          RAISE EXCEPTION 'review identity and pinned revision are immutable';
        END IF;
        IF OLD.status <> 'OPEN' AND NEW.status <> OLD.status THEN
          RAISE EXCEPTION 'terminal reviews cannot transition';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER reviews_enforce_pinning_and_terminal
        BEFORE UPDATE ON reviews
        FOR EACH ROW EXECUTE FUNCTION enforce_review_pinning_and_terminal_state();

      CREATE FUNCTION prevent_review_assignment_mutation() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'review assignments are immutable';
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER review_assignments_no_update_or_delete
        BEFORE UPDATE OR DELETE ON review_assignments
        FOR EACH ROW EXECUTE FUNCTION prevent_review_assignment_mutation();

      CREATE FUNCTION prevent_review_decision_update() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'review decisions are immutable';
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER review_decisions_no_update
        BEFORE UPDATE ON review_decisions
        FOR EACH ROW EXECUTE FUNCTION prevent_review_decision_update();
    `,
  },
  {
    id: "0005_publications_and_deployments",
    sql: `
      ALTER TABLE reviews
        ADD CONSTRAINT reviews_id_organization_project_unique
        UNIQUE (id, organization_id, project_id);

      CREATE TABLE publications (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        project_id uuid NOT NULL,
        review_id uuid NOT NULL,
        manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest) = 'object'),
        manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[a-f0-9]{64}$'),
        validation_snapshot jsonb NOT NULL CHECK (jsonb_typeof(validation_snapshot) = 'object'),
        approval_snapshot jsonb NOT NULL CHECK (jsonb_typeof(approval_snapshot) = 'object'),
        published_by uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (review_id),
        UNIQUE (id, organization_id),
        UNIQUE (id, organization_id, project_id),
        FOREIGN KEY (project_id, organization_id) REFERENCES projects(id, organization_id),
        FOREIGN KEY (review_id, organization_id, project_id)
          REFERENCES reviews(id, organization_id, project_id),
        FOREIGN KEY (published_by, organization_id) REFERENCES principals(id, organization_id)
      );

      CREATE INDEX publications_project_created_idx
        ON publications (organization_id, project_id, created_at DESC);

      CREATE TABLE artifact_versions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        artifact_id uuid NOT NULL,
        revision_id uuid NOT NULL,
        publication_id uuid NOT NULL,
        number integer NOT NULL CHECK (number > 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (artifact_id, number),
        UNIQUE (publication_id, artifact_id),
        UNIQUE (id, organization_id),
        FOREIGN KEY (artifact_id, organization_id) REFERENCES artifacts(id, organization_id),
        FOREIGN KEY (revision_id, artifact_id) REFERENCES artifact_revisions(id, artifact_id),
        FOREIGN KEY (publication_id, organization_id) REFERENCES publications(id, organization_id)
      );

      CREATE INDEX artifact_versions_revision_idx
        ON artifact_versions (organization_id, revision_id);

      CREATE TABLE environments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        project_id uuid NOT NULL,
        key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9-]{1,62}$'),
        name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (organization_id, project_id, key),
        UNIQUE (id, organization_id),
        UNIQUE (id, organization_id, project_id),
        FOREIGN KEY (project_id, organization_id) REFERENCES projects(id, organization_id)
      );

      CREATE INDEX environments_project_created_idx
        ON environments (organization_id, project_id, created_at ASC);

      CREATE TABLE deployments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        project_id uuid NOT NULL,
        environment_id uuid NOT NULL,
        publication_id uuid NOT NULL,
        sequence integer NOT NULL CHECK (sequence > 0),
        content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
        bundle_sha256 text NOT NULL CHECK (bundle_sha256 ~ '^[a-f0-9]{64}$'),
        bundle jsonb NOT NULL CHECK (jsonb_typeof(bundle) = 'object'),
        note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 2000),
        deployed_by uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (environment_id, sequence),
        UNIQUE (id, organization_id),
        FOREIGN KEY (environment_id, organization_id, project_id)
          REFERENCES environments(id, organization_id, project_id),
        FOREIGN KEY (publication_id, organization_id, project_id)
          REFERENCES publications(id, organization_id, project_id),
        FOREIGN KEY (deployed_by, organization_id) REFERENCES principals(id, organization_id)
      );

      CREATE INDEX deployments_publication_created_idx
        ON deployments (organization_id, publication_id, created_at DESC);
      CREATE INDEX deployments_environment_created_idx
        ON deployments (organization_id, environment_id, created_at DESC);

      CREATE FUNCTION prevent_release_record_mutation() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'publication and deployment records are immutable';
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER publications_no_update_or_delete
        BEFORE UPDATE OR DELETE ON publications
        FOR EACH ROW EXECUTE FUNCTION prevent_release_record_mutation();
      CREATE TRIGGER artifact_versions_no_update_or_delete
        BEFORE UPDATE OR DELETE ON artifact_versions
        FOR EACH ROW EXECUTE FUNCTION prevent_release_record_mutation();
      CREATE TRIGGER deployments_no_update_or_delete
        BEFORE UPDATE OR DELETE ON deployments
        FOR EACH ROW EXECUTE FUNCTION prevent_release_record_mutation();
    `,
  },
  {
    id: "0006_runtime_core",
    sql: `
      CREATE TABLE process_instances (
        id uuid PRIMARY KEY,
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        project_id uuid NOT NULL,
        environment_id uuid NOT NULL,
        deployment_id uuid NOT NULL,
        artifact_version_id uuid NOT NULL,
        process_name text NOT NULL CHECK (char_length(process_name) BETWEEN 1 AND 160),
        business_key text CHECK (business_key IS NULL OR char_length(business_key) BETWEEN 1 AND 255),
        status text NOT NULL CHECK (status IN ('STARTING', 'RUNNING', 'WAITING', 'COMPLETED', 'INCIDENT', 'CANCELLED')),
        revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
        pending_command_id uuid,
        active_fencing_token bigint NOT NULL DEFAULT 0 CHECK (active_fencing_token >= 0),
        current_element_id text,
        current_element_name text,
        envelope jsonb,
        envelope_sha256 text CHECK (envelope_sha256 IS NULL OR envelope_sha256 ~ '^[a-f0-9]{64}$'),
        projection_sha256 text CHECK (projection_sha256 IS NULL OR projection_sha256 ~ '^[a-f0-9]{64}$'),
        adapter_name text,
        adapter_version text,
        engine_version text,
        created_by uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz,
        UNIQUE (id, organization_id),
        FOREIGN KEY (project_id, organization_id) REFERENCES projects(id, organization_id),
        FOREIGN KEY (environment_id, organization_id, project_id)
          REFERENCES environments(id, organization_id, project_id),
        FOREIGN KEY (deployment_id, organization_id) REFERENCES deployments(id, organization_id),
        FOREIGN KEY (artifact_version_id, organization_id) REFERENCES artifact_versions(id, organization_id),
        FOREIGN KEY (created_by, organization_id) REFERENCES principals(id, organization_id),
        CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL))
      );

      CREATE UNIQUE INDEX process_instances_business_key_idx
        ON process_instances (organization_id, environment_id, business_key)
        WHERE business_key IS NOT NULL;
      CREATE INDEX process_instances_org_updated_idx
        ON process_instances (organization_id, updated_at DESC);

      CREATE TABLE runtime_commands (
        id uuid PRIMARY KEY,
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        instance_id uuid NOT NULL,
        type text NOT NULL CHECK (type IN ('START', 'TASK_COMPLETE')),
        status text NOT NULL CHECK (status IN ('ACCEPTED', 'CLAIMED', 'APPLIED', 'QUARANTINED')),
        expected_revision integer NOT NULL CHECK (expected_revision >= 0),
        target_task_id uuid,
        payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 1048576),
        idempotency_key text CHECK (idempotency_key IS NULL OR char_length(idempotency_key) BETWEEN 1 AND 255),
        fencing_token bigint,
        created_by uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        applied_at timestamptz,
        UNIQUE (id, organization_id),
        FOREIGN KEY (instance_id, organization_id) REFERENCES process_instances(id, organization_id) ON DELETE CASCADE,
        FOREIGN KEY (created_by, organization_id) REFERENCES principals(id, organization_id)
      );

      CREATE UNIQUE INDEX runtime_commands_idempotency_idx
        ON runtime_commands (organization_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL;
      CREATE INDEX runtime_commands_instance_created_idx
        ON runtime_commands (instance_id, created_at DESC);

      ALTER TABLE process_instances
        ADD CONSTRAINT process_instances_pending_command_fk
        FOREIGN KEY (pending_command_id, organization_id)
        REFERENCES runtime_commands(id, organization_id)
        DEFERRABLE INITIALLY DEFERRED;

      CREATE TABLE durable_work (
        id uuid PRIMARY KEY,
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        instance_id uuid NOT NULL,
        command_id uuid NOT NULL,
        kind text NOT NULL CHECK (kind = 'ADVANCE_INSTANCE'),
        status text NOT NULL CHECK (status IN ('AVAILABLE', 'CLAIMED', 'DONE', 'QUARANTINED')),
        available_at timestamptz NOT NULL DEFAULT now(),
        claim_owner text,
        fencing_token bigint NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
        lease_expires_at timestamptz,
        attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (command_id),
        UNIQUE (id, organization_id),
        FOREIGN KEY (instance_id, organization_id) REFERENCES process_instances(id, organization_id) ON DELETE CASCADE,
        FOREIGN KEY (command_id, organization_id) REFERENCES runtime_commands(id, organization_id) ON DELETE CASCADE,
        CHECK ((status = 'CLAIMED') = (claim_owner IS NOT NULL AND lease_expires_at IS NOT NULL))
      );

      CREATE INDEX durable_work_available_idx
        ON durable_work (available_at, created_at)
        WHERE status IN ('AVAILABLE', 'CLAIMED');

      CREATE TABLE process_tasks (
        id uuid PRIMARY KEY,
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        instance_id uuid NOT NULL,
        checkpoint_revision integer NOT NULL CHECK (checkpoint_revision > 0),
        element_id text NOT NULL CHECK (char_length(element_id) BETWEEN 1 AND 255),
        element_name text NOT NULL CHECK (char_length(element_name) BETWEEN 1 AND 255),
        execution_id text NOT NULL CHECK (char_length(execution_id) BETWEEN 1 AND 255),
        status text NOT NULL CHECK (status IN ('OPEN', 'COMPLETED', 'CANCELLED')),
        assignee_id uuid NOT NULL,
        submission jsonb,
        completed_by uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz,
        UNIQUE (id, organization_id),
        UNIQUE (instance_id, checkpoint_revision, execution_id),
        FOREIGN KEY (instance_id, organization_id) REFERENCES process_instances(id, organization_id) ON DELETE CASCADE,
        FOREIGN KEY (assignee_id, organization_id) REFERENCES principals(id, organization_id),
        FOREIGN KEY (completed_by, organization_id) REFERENCES principals(id, organization_id),
        CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL AND completed_by IS NOT NULL AND submission IS NOT NULL))
      );

      ALTER TABLE runtime_commands
        ADD CONSTRAINT runtime_commands_target_task_fk
        FOREIGN KEY (target_task_id, organization_id)
        REFERENCES process_tasks(id, organization_id);

      CREATE UNIQUE INDEX process_tasks_open_execution_idx
        ON process_tasks (instance_id, execution_id) WHERE status = 'OPEN';
      CREATE INDEX process_tasks_assignee_open_idx
        ON process_tasks (organization_id, assignee_id, created_at DESC) WHERE status = 'OPEN';

      CREATE TABLE process_variable_snapshots (
        instance_id uuid NOT NULL,
        organization_id uuid NOT NULL,
        checkpoint_revision integer NOT NULL CHECK (checkpoint_revision >= 0),
        variables jsonb NOT NULL CHECK (jsonb_typeof(variables) = 'object' AND octet_length(variables::text) <= 1048576),
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (instance_id, checkpoint_revision),
        FOREIGN KEY (instance_id, organization_id) REFERENCES process_instances(id, organization_id) ON DELETE CASCADE
      );

      CREATE TABLE process_checkpoints (
        instance_id uuid NOT NULL,
        organization_id uuid NOT NULL,
        revision integer NOT NULL CHECK (revision > 0),
        status text NOT NULL CHECK (status IN ('WAITING', 'COMPLETED')),
        envelope jsonb NOT NULL CHECK (jsonb_typeof(envelope) = 'object'),
        envelope_sha256 text NOT NULL CHECK (envelope_sha256 ~ '^[a-f0-9]{64}$'),
        projection_sha256 text NOT NULL CHECK (projection_sha256 ~ '^[a-f0-9]{64}$'),
        command_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (instance_id, revision),
        FOREIGN KEY (instance_id, organization_id) REFERENCES process_instances(id, organization_id) ON DELETE CASCADE,
        FOREIGN KEY (command_id, organization_id) REFERENCES runtime_commands(id, organization_id)
      );

      CREATE TABLE execution_events (
        id uuid PRIMARY KEY,
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        instance_id uuid NOT NULL,
        sequence integer NOT NULL CHECK (sequence > 0),
        checkpoint_revision integer NOT NULL CHECK (checkpoint_revision > 0),
        type text NOT NULL CHECK (char_length(type) BETWEEN 1 AND 80),
        element_id text,
        element_name text,
        actor_id uuid,
        data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object'),
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (instance_id, sequence),
        FOREIGN KEY (instance_id, organization_id) REFERENCES process_instances(id, organization_id) ON DELETE CASCADE,
        FOREIGN KEY (actor_id, organization_id) REFERENCES principals(id, organization_id)
      );

      CREATE INDEX execution_events_instance_sequence_idx
        ON execution_events (instance_id, sequence ASC);

      CREATE TABLE runtime_incidents (
        id uuid PRIMARY KEY,
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        instance_id uuid NOT NULL,
        command_id uuid NOT NULL,
        code text NOT NULL CHECK (char_length(code) BETWEEN 1 AND 120),
        message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 4000),
        status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED')),
        created_at timestamptz NOT NULL DEFAULT now(),
        resolved_at timestamptz,
        FOREIGN KEY (instance_id, organization_id) REFERENCES process_instances(id, organization_id) ON DELETE CASCADE,
        FOREIGN KEY (command_id, organization_id) REFERENCES runtime_commands(id, organization_id)
      );

      CREATE INDEX runtime_incidents_instance_open_idx
        ON runtime_incidents (instance_id, created_at DESC) WHERE status = 'OPEN';
    `,
  },
  {
    id: "0007_runtime_idempotency_hashes",
    sql: `
      ALTER TABLE runtime_commands ADD COLUMN request_sha256 text;
      UPDATE runtime_commands
      SET request_sha256 = encode(digest(
        type || ':' || coalesce(target_task_id::text, '') || ':' || payload::text,
        'sha256'
      ), 'hex');
      ALTER TABLE runtime_commands
        ALTER COLUMN request_sha256 SET NOT NULL,
        ADD CONSTRAINT runtime_commands_request_sha256_format
          CHECK (request_sha256 ~ '^[a-f0-9]{64}$');
    `,
  },
  {
    id: "0008_portable_forms",
    sql: `
      CREATE TABLE review_artifact_dependencies (
        review_id uuid NOT NULL,
        organization_id uuid NOT NULL,
        project_id uuid NOT NULL,
        artifact_id uuid NOT NULL,
        revision_id uuid NOT NULL,
        artifact_key text NOT NULL,
        artifact_type artifact_type NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (review_id, artifact_id),
        FOREIGN KEY (review_id, organization_id, project_id)
          REFERENCES reviews(id, organization_id, project_id) ON DELETE CASCADE,
        FOREIGN KEY (artifact_id, organization_id)
          REFERENCES artifacts(id, organization_id),
        FOREIGN KEY (revision_id, artifact_id)
          REFERENCES artifact_revisions(id, artifact_id),
        CHECK (artifact_type = 'FORM')
      );

      CREATE FUNCTION prevent_review_dependency_mutation() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'review dependencies are immutable';
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER review_dependencies_no_update_or_delete
        BEFORE UPDATE OR DELETE ON review_artifact_dependencies
        FOR EACH ROW EXECUTE FUNCTION prevent_review_dependency_mutation();

      ALTER TABLE process_tasks
        ADD COLUMN form_key text,
        ADD COLUMN form_version_id uuid,
        ADD COLUMN form_schema jsonb,
        ADD COLUMN form_schema_sha256 text,
        ADD COLUMN form_data jsonb,
        ADD COLUMN input_mapping jsonb,
        ADD COLUMN output_mapping jsonb,
        ADD CONSTRAINT process_tasks_form_version_fk
          FOREIGN KEY (form_version_id, organization_id)
          REFERENCES artifact_versions(id, organization_id),
        ADD CONSTRAINT process_tasks_form_snapshot_complete CHECK (
          (form_key IS NULL AND form_version_id IS NULL AND form_schema IS NULL
            AND form_schema_sha256 IS NULL AND form_data IS NULL
            AND input_mapping IS NULL AND output_mapping IS NULL)
          OR
          (form_key IS NOT NULL AND char_length(form_key) BETWEEN 2 AND 63
            AND form_version_id IS NOT NULL
            AND jsonb_typeof(form_schema) = 'object'
            AND form_schema_sha256 ~ '^[a-f0-9]{64}$'
            AND jsonb_typeof(form_data) = 'object'
            AND jsonb_typeof(input_mapping) = 'object'
            AND jsonb_typeof(output_mapping) = 'object')
        );
    `,
  },
  {
    id: "0009_external_jobs",
    sql: `
      CREATE TABLE worker_credentials (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        project_id uuid NOT NULL,
        name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
        token_prefix text NOT NULL CHECK (char_length(token_prefix) BETWEEN 8 AND 32),
        token_sha256 text NOT NULL CHECK (token_sha256 ~ '^[a-f0-9]{64}$'),
        created_by uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_used_at timestamptz,
        revoked_at timestamptz,
        UNIQUE (token_sha256),
        UNIQUE (id, organization_id),
        FOREIGN KEY (project_id, organization_id) REFERENCES projects(id, organization_id) ON DELETE CASCADE,
        FOREIGN KEY (created_by, organization_id) REFERENCES principals(id, organization_id)
      );

      CREATE INDEX worker_credentials_project_idx
        ON worker_credentials (organization_id, project_id, created_at DESC);

      CREATE TABLE process_jobs (
        id uuid PRIMARY KEY,
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        instance_id uuid NOT NULL,
        checkpoint_revision integer NOT NULL CHECK (checkpoint_revision > 0),
        element_id text NOT NULL CHECK (char_length(element_id) BETWEEN 1 AND 255),
        element_name text NOT NULL CHECK (char_length(element_name) BETWEEN 1 AND 255),
        execution_id text NOT NULL CHECK (char_length(execution_id) BETWEEN 1 AND 255),
        job_type text NOT NULL CHECK (job_type ~ '^[a-z][a-z0-9.-]{1,119}$'),
        input jsonb NOT NULL CHECK (jsonb_typeof(input) = 'object'),
        headers jsonb NOT NULL CHECK (jsonb_typeof(headers) = 'object'),
        output_mapping jsonb NOT NULL CHECK (jsonb_typeof(output_mapping) = 'object'),
        lock_duration_seconds integer NOT NULL CHECK (lock_duration_seconds BETWEEN 5 AND 3600),
        max_attempts integer NOT NULL CHECK (max_attempts BETWEEN 1 AND 20),
        retry_backoff_seconds integer NOT NULL CHECK (retry_backoff_seconds BETWEEN 1 AND 86400),
        effect_key text NOT NULL CHECK (effect_key ~ '^[a-f0-9]{64}$'),
        status text NOT NULL CHECK (status IN ('WAITING', 'COMPLETED', 'CANCELLED')),
        result jsonb,
        completed_by_credential_id uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz,
        UNIQUE (id, organization_id),
        UNIQUE (instance_id, checkpoint_revision, execution_id),
        UNIQUE (instance_id, effect_key),
        FOREIGN KEY (instance_id, organization_id) REFERENCES process_instances(id, organization_id) ON DELETE CASCADE,
        FOREIGN KEY (completed_by_credential_id, organization_id) REFERENCES worker_credentials(id, organization_id),
        CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL AND result IS NOT NULL))
      );

      CREATE UNIQUE INDEX process_jobs_waiting_execution_idx
        ON process_jobs (instance_id, execution_id) WHERE status = 'WAITING';
      CREATE INDEX process_jobs_type_waiting_idx
        ON process_jobs (organization_id, job_type, created_at) WHERE status = 'WAITING';

      CREATE TABLE external_job_deliveries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        job_id uuid NOT NULL,
        attempt integer NOT NULL CHECK (attempt > 0),
        retry_cycle integer NOT NULL CHECK (retry_cycle > 0),
        cycle_attempt integer NOT NULL CHECK (cycle_attempt > 0),
        status text NOT NULL CHECK (status IN ('AVAILABLE', 'LOCKED', 'FAILED', 'SUCCEEDED', 'SUPERSEDED')),
        available_at timestamptz NOT NULL DEFAULT now(),
        worker_id text,
        credential_id uuid,
        fencing_token bigint NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
        lock_expires_at timestamptz,
        failure_code text CHECK (failure_code IS NULL OR char_length(failure_code) BETWEEN 1 AND 120),
        failure_message text CHECK (failure_message IS NULL OR char_length(failure_message) BETWEEN 1 AND 4000),
        result jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        finished_at timestamptz,
        UNIQUE (id, organization_id),
        UNIQUE (job_id, attempt),
        FOREIGN KEY (job_id, organization_id) REFERENCES process_jobs(id, organization_id) ON DELETE CASCADE,
        FOREIGN KEY (credential_id, organization_id) REFERENCES worker_credentials(id, organization_id),
        CHECK ((status = 'LOCKED') = (worker_id IS NOT NULL AND credential_id IS NOT NULL AND lock_expires_at IS NOT NULL)),
        CHECK ((status IN ('FAILED', 'SUCCEEDED', 'SUPERSEDED')) = (finished_at IS NOT NULL))
      );

      CREATE UNIQUE INDEX external_job_deliveries_current_idx
        ON external_job_deliveries (job_id) WHERE status IN ('AVAILABLE', 'LOCKED');
      CREATE INDEX external_job_deliveries_available_idx
        ON external_job_deliveries (organization_id, available_at, created_at)
        WHERE status IN ('AVAILABLE', 'LOCKED');

      ALTER TABLE runtime_commands DROP CONSTRAINT runtime_commands_type_check;
      ALTER TABLE runtime_commands
        ADD CONSTRAINT runtime_commands_type_check CHECK (type IN ('START', 'TASK_COMPLETE', 'JOB_COMPLETE')),
        ADD COLUMN target_job_id uuid,
        ADD CONSTRAINT runtime_commands_target_job_fk
          FOREIGN KEY (target_job_id, organization_id) REFERENCES process_jobs(id, organization_id);

      ALTER TABLE runtime_incidents ALTER COLUMN command_id DROP NOT NULL;
      ALTER TABLE runtime_incidents
        ADD COLUMN job_id uuid,
        ADD COLUMN delivery_id uuid,
        ADD CONSTRAINT runtime_incidents_job_fk
          FOREIGN KEY (job_id, organization_id) REFERENCES process_jobs(id, organization_id),
        ADD CONSTRAINT runtime_incidents_delivery_fk
          FOREIGN KEY (delivery_id, organization_id) REFERENCES external_job_deliveries(id, organization_id),
        ADD CONSTRAINT runtime_incidents_source_check
          CHECK (command_id IS NOT NULL OR job_id IS NOT NULL);
    `,
  },
  {
    id: "0010_durable_timers",
    sql: `
      CREATE TABLE process_timers (
        id uuid PRIMARY KEY,
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        instance_id uuid NOT NULL,
        checkpoint_revision integer NOT NULL CHECK (checkpoint_revision > 0),
        element_id text NOT NULL CHECK (char_length(element_id) BETWEEN 1 AND 255),
        element_name text NOT NULL CHECK (char_length(element_name) BETWEEN 1 AND 255),
        execution_id text NOT NULL CHECK (char_length(execution_id) BETWEEN 1 AND 255),
        timer_type text NOT NULL CHECK (timer_type IN ('DURATION', 'DATE')),
        expression text NOT NULL CHECK (char_length(expression) BETWEEN 1 AND 255),
        duration_milliseconds bigint CHECK (duration_milliseconds IS NULL OR duration_milliseconds BETWEEN 0 AND 315360000000),
        due_at timestamptz NOT NULL,
        status text NOT NULL CHECK (status IN ('WAITING', 'FIRED', 'CANCELLED')),
        created_at timestamptz NOT NULL DEFAULT now(),
        fired_at timestamptz,
        UNIQUE (id, organization_id),
        UNIQUE (instance_id, checkpoint_revision, execution_id),
        FOREIGN KEY (instance_id, organization_id)
          REFERENCES process_instances(id, organization_id) ON DELETE CASCADE,
        CHECK (
          (timer_type = 'DURATION' AND duration_milliseconds IS NOT NULL)
          OR (timer_type = 'DATE' AND duration_milliseconds IS NULL)
        ),
        CHECK ((status = 'FIRED') = (fired_at IS NOT NULL))
      );

      CREATE UNIQUE INDEX process_timers_waiting_execution_idx
        ON process_timers (instance_id, execution_id) WHERE status = 'WAITING';
      CREATE INDEX process_timers_due_idx
        ON process_timers (due_at, created_at) WHERE status = 'WAITING';

      ALTER TABLE runtime_commands DROP CONSTRAINT runtime_commands_type_check;
      ALTER TABLE runtime_commands
        ADD CONSTRAINT runtime_commands_type_check
          CHECK (type IN ('START', 'TASK_COMPLETE', 'JOB_COMPLETE', 'TIMER_FIRE')),
        ADD COLUMN target_timer_id uuid,
        ADD CONSTRAINT runtime_commands_target_timer_fk
          FOREIGN KEY (target_timer_id, organization_id) REFERENCES process_timers(id, organization_id);

      CREATE UNIQUE INDEX runtime_commands_timer_fire_idx
        ON runtime_commands (target_timer_id) WHERE target_timer_id IS NOT NULL;

      ALTER TABLE runtime_incidents
        ADD COLUMN timer_id uuid,
        ADD CONSTRAINT runtime_incidents_timer_fk
          FOREIGN KEY (timer_id, organization_id) REFERENCES process_timers(id, organization_id);
    `,
  },
  {
    id: "0011_durable_message_subscriptions",
    sql: `
      CREATE TABLE message_subscriptions (
        id uuid PRIMARY KEY,
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        instance_id uuid NOT NULL,
        checkpoint_revision integer NOT NULL CHECK (checkpoint_revision > 0),
        element_id text NOT NULL CHECK (char_length(element_id) BETWEEN 1 AND 255),
        element_name text NOT NULL CHECK (char_length(element_name) BETWEEN 1 AND 255),
        execution_id text NOT NULL CHECK (char_length(execution_id) BETWEEN 1 AND 255),
        message_name text NOT NULL CHECK (message_name ~ '^[a-z][a-z0-9.-]{1,119}$'),
        correlation_key text NOT NULL CHECK (char_length(correlation_key) BETWEEN 1 AND 255),
        status text NOT NULL CHECK (status IN ('WAITING', 'CONSUMED', 'CANCELLED')),
        payload jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        consumed_at timestamptz,
        UNIQUE (id, organization_id),
        UNIQUE (instance_id, checkpoint_revision, execution_id),
        FOREIGN KEY (instance_id, organization_id)
          REFERENCES process_instances(id, organization_id) ON DELETE CASCADE,
        CHECK ((status = 'CONSUMED') = (consumed_at IS NOT NULL))
      );

      CREATE UNIQUE INDEX message_subscriptions_waiting_execution_idx
        ON message_subscriptions (instance_id, execution_id) WHERE status = 'WAITING';
      CREATE INDEX message_subscriptions_correlation_idx
        ON message_subscriptions (organization_id, message_name, correlation_key, created_at)
        WHERE status = 'WAITING';

      ALTER TABLE runtime_commands DROP CONSTRAINT runtime_commands_type_check;
      ALTER TABLE runtime_commands
        ADD CONSTRAINT runtime_commands_type_check
          CHECK (type IN ('START', 'TASK_COMPLETE', 'JOB_COMPLETE', 'TIMER_FIRE', 'MESSAGE_CORRELATE')),
        ADD COLUMN target_subscription_id uuid,
        ADD CONSTRAINT runtime_commands_target_subscription_fk
          FOREIGN KEY (target_subscription_id, organization_id)
          REFERENCES message_subscriptions(id, organization_id);

      CREATE UNIQUE INDEX runtime_commands_message_correlation_idx
        ON runtime_commands (target_subscription_id) WHERE target_subscription_id IS NOT NULL;

      CREATE TABLE message_correlation_attempts (
        id uuid PRIMARY KEY,
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        environment_id uuid NOT NULL,
        message_name text NOT NULL CHECK (message_name ~ '^[a-z][a-z0-9.-]{1,119}$'),
        correlation_key text NOT NULL CHECK (char_length(correlation_key) BETWEEN 1 AND 255),
        payload jsonb NOT NULL,
        idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 255),
        request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
        outcome text NOT NULL CHECK (outcome IN ('CORRELATED', 'NO_MATCH', 'AMBIGUOUS')),
        subscription_id uuid,
        command_id uuid,
        created_by uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (organization_id, idempotency_key),
        FOREIGN KEY (environment_id, organization_id)
          REFERENCES environments(id, organization_id),
        FOREIGN KEY (subscription_id, organization_id)
          REFERENCES message_subscriptions(id, organization_id),
        FOREIGN KEY (command_id, organization_id)
          REFERENCES runtime_commands(id, organization_id),
        FOREIGN KEY (created_by, organization_id)
          REFERENCES principals(id, organization_id),
        CHECK (
          (outcome = 'CORRELATED' AND subscription_id IS NOT NULL AND command_id IS NOT NULL)
          OR (outcome IN ('NO_MATCH', 'AMBIGUOUS') AND subscription_id IS NULL AND command_id IS NULL)
        )
      );

      ALTER TABLE runtime_incidents
        ADD COLUMN subscription_id uuid,
        ADD CONSTRAINT runtime_incidents_subscription_fk
          FOREIGN KEY (subscription_id, organization_id)
          REFERENCES message_subscriptions(id, organization_id);
    `,
  },
  {
    id: "0012_message_delivery_outbox",
    sql: `
      CREATE TABLE message_deliveries (
        id uuid PRIMARY KEY,
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        instance_id uuid NOT NULL,
        environment_id uuid NOT NULL,
        checkpoint_revision integer NOT NULL CHECK (checkpoint_revision > 0),
        element_id text NOT NULL CHECK (char_length(element_id) BETWEEN 1 AND 255),
        element_name text NOT NULL CHECK (char_length(element_name) BETWEEN 1 AND 255),
        execution_id text NOT NULL CHECK (char_length(execution_id) BETWEEN 1 AND 255),
        message_name text NOT NULL CHECK (message_name ~ '^[a-z][a-z0-9.-]{1,119}$'),
        correlation_key text NOT NULL CHECK (char_length(correlation_key) BETWEEN 1 AND 255),
        payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 1048576),
        status text NOT NULL CHECK (status IN ('AVAILABLE', 'CLAIMED', 'DELIVERED', 'NO_MATCH', 'AMBIGUOUS')),
        available_at timestamptz NOT NULL DEFAULT now(),
        claim_owner text,
        fencing_token bigint NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
        lease_expires_at timestamptz,
        attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        correlation_attempt_id uuid,
        target_subscription_id uuid,
        last_error text,
        created_by uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        delivered_at timestamptz,
        UNIQUE (id, organization_id),
        UNIQUE (instance_id, checkpoint_revision, execution_id),
        FOREIGN KEY (instance_id, organization_id)
          REFERENCES process_instances(id, organization_id) ON DELETE CASCADE,
        FOREIGN KEY (environment_id, organization_id)
          REFERENCES environments(id, organization_id),
        FOREIGN KEY (correlation_attempt_id)
          REFERENCES message_correlation_attempts(id),
        FOREIGN KEY (target_subscription_id)
          REFERENCES message_subscriptions(id),
        FOREIGN KEY (created_by, organization_id)
          REFERENCES principals(id, organization_id),
        CHECK ((status = 'CLAIMED') = (claim_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
        CHECK ((status IN ('DELIVERED', 'NO_MATCH', 'AMBIGUOUS')) = (delivered_at IS NOT NULL)),
        CHECK ((status = 'DELIVERED') = (target_subscription_id IS NOT NULL))
      );

      CREATE INDEX message_deliveries_dispatch_idx
        ON message_deliveries (available_at, created_at)
        WHERE status IN ('AVAILABLE', 'CLAIMED');
      CREATE INDEX message_deliveries_instance_idx
        ON message_deliveries (instance_id, created_at DESC);
    `,
  },
  {
    id: "0013_dmn_decision_evidence",
    sql: `
      ALTER TABLE review_artifact_dependencies
        DROP CONSTRAINT review_artifact_dependencies_artifact_type_check,
        ADD CONSTRAINT review_artifact_dependencies_artifact_type_check
          CHECK (artifact_type IN ('FORM', 'DMN_DECISION'));

      CREATE TABLE decision_evaluations (
        id uuid PRIMARY KEY,
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        project_id uuid NOT NULL,
        environment_id uuid NOT NULL,
        deployment_id uuid NOT NULL,
        publication_id uuid NOT NULL,
        decision_artifact_version_id uuid NOT NULL,
        decision_key text NOT NULL CHECK (decision_key ~ '^[a-z][a-z0-9.-]{1,119}$'),
        decision_id text NOT NULL CHECK (char_length(decision_id) BETWEEN 1 AND 255),
        decision_name text NOT NULL CHECK (char_length(decision_name) BETWEEN 1 AND 255),
        hit_policy text NOT NULL CHECK (hit_policy IN ('UNIQUE', 'FIRST')),
        input jsonb NOT NULL CHECK (jsonb_typeof(input) = 'object'),
        output jsonb CHECK (output IS NULL OR jsonb_typeof(output) = 'object'),
        matched_rule_ids text[] NOT NULL,
        outcome text NOT NULL CHECK (outcome IN ('MATCHED', 'NO_MATCH')),
        request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
        idempotency_key text CHECK (idempotency_key IS NULL OR char_length(idempotency_key) BETWEEN 1 AND 255),
        source_instance_id uuid,
        source_element_id text,
        source_element_name text,
        checkpoint_revision integer CHECK (checkpoint_revision IS NULL OR checkpoint_revision > 0),
        created_by uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (id, organization_id),
        FOREIGN KEY (project_id, organization_id) REFERENCES projects(id, organization_id),
        FOREIGN KEY (environment_id, organization_id, project_id)
          REFERENCES environments(id, organization_id, project_id),
        FOREIGN KEY (deployment_id, organization_id) REFERENCES deployments(id, organization_id),
        FOREIGN KEY (publication_id, organization_id, project_id)
          REFERENCES publications(id, organization_id, project_id),
        FOREIGN KEY (decision_artifact_version_id, organization_id)
          REFERENCES artifact_versions(id, organization_id),
        FOREIGN KEY (source_instance_id, organization_id)
          REFERENCES process_instances(id, organization_id) ON DELETE CASCADE,
        FOREIGN KEY (created_by, organization_id) REFERENCES principals(id, organization_id),
        CHECK (
          (source_instance_id IS NULL AND source_element_id IS NULL AND source_element_name IS NULL AND checkpoint_revision IS NULL)
          OR
          (source_instance_id IS NOT NULL AND source_element_id IS NOT NULL AND source_element_name IS NOT NULL AND checkpoint_revision IS NOT NULL)
        )
      );

      CREATE UNIQUE INDEX decision_evaluations_idempotency_idx
        ON decision_evaluations (organization_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL;
      CREATE UNIQUE INDEX decision_evaluations_runtime_idx
        ON decision_evaluations (source_instance_id, checkpoint_revision, source_element_id)
        WHERE source_instance_id IS NOT NULL;
      CREATE INDEX decision_evaluations_instance_created_idx
        ON decision_evaluations (source_instance_id, created_at DESC)
        WHERE source_instance_id IS NOT NULL;
      CREATE INDEX decision_evaluations_deployment_created_idx
        ON decision_evaluations (organization_id, deployment_id, created_at DESC);
    `,
  },
  {
    id: "0014_business_studio_collaboration",
    sql: `
      CREATE TABLE artifact_editor_presence (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        artifact_id uuid NOT NULL,
        revision_id uuid NOT NULL,
        principal_id uuid NOT NULL,
        client_id text NOT NULL CHECK (char_length(client_id) BETWEEN 8 AND 120),
        selected_element_id text CHECK (
          selected_element_id IS NULL OR selected_element_id ~ '^[A-Za-z_][A-Za-z0-9_.:-]{0,254}$'
        ),
        selected_element_name text CHECK (
          selected_element_name IS NULL OR char_length(selected_element_name) BETWEEN 1 AND 255
        ),
        selected_element_type text CHECK (
          selected_element_type IS NULL OR char_length(selected_element_type) BETWEEN 1 AND 120
        ),
        state text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'IDLE')),
        created_at timestamptz NOT NULL DEFAULT now(),
        last_seen_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (artifact_id, principal_id, client_id),
        FOREIGN KEY (artifact_id, organization_id)
          REFERENCES artifacts(id, organization_id) ON DELETE CASCADE,
        FOREIGN KEY (revision_id, artifact_id)
          REFERENCES artifact_revisions(id, artifact_id),
        FOREIGN KEY (principal_id, organization_id)
          REFERENCES principals(id, organization_id) ON DELETE CASCADE,
        CHECK (
          (selected_element_id IS NULL AND selected_element_name IS NULL AND selected_element_type IS NULL)
          OR
          (selected_element_id IS NOT NULL AND selected_element_name IS NOT NULL AND selected_element_type IS NOT NULL)
        )
      );

      CREATE INDEX artifact_editor_presence_active_idx
        ON artifact_editor_presence (artifact_id, last_seen_at DESC);

      CREATE TABLE review_comment_mentions (
        review_id uuid NOT NULL,
        comment_id uuid NOT NULL,
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        principal_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (comment_id, principal_id),
        FOREIGN KEY (comment_id, review_id)
          REFERENCES review_comments(id, review_id) ON DELETE CASCADE,
        FOREIGN KEY (review_id, organization_id)
          REFERENCES reviews(id, organization_id) ON DELETE CASCADE,
        FOREIGN KEY (principal_id, organization_id)
          REFERENCES principals(id, organization_id)
      );

      ALTER TABLE process_tasks
        ADD COLUMN due_at timestamptz,
        ADD COLUMN priority text NOT NULL DEFAULT 'NORMAL'
          CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
        ADD COLUMN delegated_from uuid,
        ADD COLUMN delegated_by uuid,
        ADD COLUMN delegated_at timestamptz,
        ADD CONSTRAINT process_tasks_delegated_from_fk
          FOREIGN KEY (delegated_from, organization_id) REFERENCES principals(id, organization_id),
        ADD CONSTRAINT process_tasks_delegated_by_fk
          FOREIGN KEY (delegated_by, organization_id) REFERENCES principals(id, organization_id),
        ADD CONSTRAINT process_tasks_delegation_complete CHECK (
          (delegated_from IS NULL AND delegated_by IS NULL AND delegated_at IS NULL)
          OR
          (delegated_from IS NOT NULL AND delegated_by IS NOT NULL AND delegated_at IS NOT NULL)
        );

      CREATE INDEX process_tasks_due_open_idx
        ON process_tasks (organization_id, due_at, created_at)
        WHERE status = 'OPEN';

      CREATE TABLE process_task_assignment_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        task_id uuid NOT NULL,
        from_assignee_id uuid NOT NULL,
        to_assignee_id uuid NOT NULL,
        changed_by uuid NOT NULL,
        due_at timestamptz,
        note text CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 1000),
        created_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (task_id, organization_id)
          REFERENCES process_tasks(id, organization_id) ON DELETE CASCADE,
        FOREIGN KEY (from_assignee_id, organization_id)
          REFERENCES principals(id, organization_id),
        FOREIGN KEY (to_assignee_id, organization_id)
          REFERENCES principals(id, organization_id),
        FOREIGN KEY (changed_by, organization_id)
          REFERENCES principals(id, organization_id)
      );

      CREATE INDEX process_task_assignment_events_task_idx
        ON process_task_assignment_events (task_id, created_at ASC);
    `,
  },
  {
    id: "0015_team_pilot_readiness",
    sql: `
      CREATE TABLE organization_invitations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        workspace_id uuid NOT NULL,
        email text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 320),
        display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
        role text NOT NULL CHECK (role IN (
          'workspace-admin', 'designer', 'reviewer', 'operator', 'task-worker'
        )),
        token_sha256 text NOT NULL UNIQUE CHECK (token_sha256 ~ '^[a-f0-9]{64}$'),
        invited_by uuid NOT NULL,
        expires_at timestamptz NOT NULL,
        accepted_at timestamptz,
        revoked_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (id, organization_id),
        FOREIGN KEY (workspace_id, organization_id)
          REFERENCES workspaces(id, organization_id) ON DELETE CASCADE,
        FOREIGN KEY (invited_by, organization_id)
          REFERENCES principals(id, organization_id),
        CHECK (accepted_at IS NULL OR revoked_at IS NULL)
      );

      CREATE UNIQUE INDEX organization_invitations_pending_email_idx
        ON organization_invitations (organization_id, workspace_id, lower(email))
        WHERE accepted_at IS NULL AND revoked_at IS NULL;
      CREATE INDEX organization_invitations_workspace_created_idx
        ON organization_invitations (workspace_id, created_at DESC);

      CREATE TABLE work_groups (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        workspace_id uuid NOT NULL,
        key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9-]{1,62}$'),
        name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
        created_by uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (organization_id, workspace_id, key),
        UNIQUE (id, organization_id),
        FOREIGN KEY (workspace_id, organization_id)
          REFERENCES workspaces(id, organization_id) ON DELETE CASCADE,
        FOREIGN KEY (created_by, organization_id)
          REFERENCES principals(id, organization_id)
      );

      CREATE TABLE work_group_members (
        group_id uuid NOT NULL,
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        principal_id uuid NOT NULL,
        added_by uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (group_id, principal_id),
        FOREIGN KEY (group_id, organization_id)
          REFERENCES work_groups(id, organization_id) ON DELETE CASCADE,
        FOREIGN KEY (principal_id, organization_id)
          REFERENCES principals(id, organization_id) ON DELETE CASCADE,
        FOREIGN KEY (added_by, organization_id)
          REFERENCES principals(id, organization_id)
      );

      CREATE INDEX work_group_members_principal_idx
        ON work_group_members (organization_id, principal_id, group_id);

      CREATE TABLE notifications (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        recipient_id uuid NOT NULL,
        actor_id uuid,
        kind text NOT NULL CHECK (kind IN (
          'INVITATION_ACCEPTED', 'REVIEW_REQUESTED', 'REVIEW_MENTIONED',
          'REVIEW_DECIDED', 'TASK_AVAILABLE', 'TASK_HANDED_OFF',
          'INCIDENT_OPENED', 'INCIDENT_ASSIGNED', 'INCIDENT_RESOLVED'
        )),
        title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 180),
        body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
        href text NOT NULL CHECK (href ~ '^/'),
        resource_type text NOT NULL CHECK (char_length(resource_type) BETWEEN 1 AND 80),
        resource_id uuid NOT NULL,
        dedupe_key text,
        read_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (recipient_id, organization_id)
          REFERENCES principals(id, organization_id) ON DELETE CASCADE,
        FOREIGN KEY (actor_id, organization_id)
          REFERENCES principals(id, organization_id)
      );

      CREATE UNIQUE INDEX notifications_dedupe_idx
        ON notifications (organization_id, recipient_id, dedupe_key)
        WHERE dedupe_key IS NOT NULL;
      CREATE INDEX notifications_recipient_unread_idx
        ON notifications (organization_id, recipient_id, created_at DESC)
        WHERE read_at IS NULL;

      ALTER TABLE process_tasks
        ADD COLUMN checkpoint_assignee_id uuid,
        ADD COLUMN candidate_group_id uuid,
        ADD CONSTRAINT process_tasks_checkpoint_assignee_fk
          FOREIGN KEY (checkpoint_assignee_id, organization_id)
          REFERENCES principals(id, organization_id),
        ADD CONSTRAINT process_tasks_candidate_group_fk
          FOREIGN KEY (candidate_group_id, organization_id)
          REFERENCES work_groups(id, organization_id);

      UPDATE process_tasks SET checkpoint_assignee_id = assignee_id;
      ALTER TABLE process_tasks ALTER COLUMN assignee_id DROP NOT NULL;
      ALTER TABLE process_task_assignment_events ALTER COLUMN from_assignee_id DROP NOT NULL;

      CREATE INDEX process_tasks_candidate_group_open_idx
        ON process_tasks (organization_id, candidate_group_id, created_at)
        WHERE status = 'OPEN' AND assignee_id IS NULL;

      ALTER TABLE runtime_incidents
        ADD COLUMN owner_id uuid,
        ADD CONSTRAINT runtime_incidents_owner_fk
          FOREIGN KEY (owner_id, organization_id) REFERENCES principals(id, organization_id);

      CREATE TABLE runtime_incident_notes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        incident_id uuid NOT NULL,
        author_id uuid NOT NULL,
        action text NOT NULL CHECK (action IN ('NOTE', 'OWNER_CHANGED', 'RETRY_STARTED', 'RESOLVED')),
        body text CHECK (body IS NULL OR char_length(body) BETWEEN 1 AND 2000),
        created_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (incident_id) REFERENCES runtime_incidents(id) ON DELETE CASCADE,
        FOREIGN KEY (author_id, organization_id) REFERENCES principals(id, organization_id)
      );

      CREATE INDEX runtime_incident_notes_incident_idx
        ON runtime_incident_notes (incident_id, created_at ASC);
    `,
  },
  {
    id: "0016_live_studio_awareness",
    sql: `
      ALTER TABLE artifact_editor_presence
        ADD COLUMN cursor_x double precision,
        ADD COLUMN cursor_y double precision,
        ADD CONSTRAINT artifact_editor_presence_cursor_range CHECK (
          (cursor_x IS NULL AND cursor_y IS NULL)
          OR
          (
            cursor_x IS NOT NULL AND cursor_y IS NOT NULL
            AND cursor_x >= 0 AND cursor_x <= 1
            AND cursor_y >= 0 AND cursor_y <= 1
          )
        );
    `,
  },
  {
    id: "0017_ai_experience_builder",
    sql: `
      CREATE TABLE ai_experiences (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        project_id uuid NOT NULL,
        title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
        description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 2000),
        status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
        transcript jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(transcript) = 'array'),
        created_by uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (id, organization_id),
        FOREIGN KEY (project_id, organization_id) REFERENCES projects(id, organization_id),
        FOREIGN KEY (created_by, organization_id) REFERENCES principals(id, organization_id)
      );

      CREATE INDEX ai_experiences_project_updated_idx
        ON ai_experiences (organization_id, project_id, updated_at DESC);

      CREATE TABLE ai_experience_artifacts (
        experience_id uuid NOT NULL,
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        artifact_id uuid NOT NULL,
        role text NOT NULL CHECK (role IN ('MAIN', 'FORM', 'DECISION')),
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (experience_id, artifact_id),
        FOREIGN KEY (experience_id, organization_id)
          REFERENCES ai_experiences(id, organization_id) ON DELETE CASCADE,
        FOREIGN KEY (artifact_id, organization_id)
          REFERENCES artifacts(id, organization_id) ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX ai_experience_one_main_idx
        ON ai_experience_artifacts (experience_id) WHERE role = 'MAIN';
      CREATE INDEX ai_experience_artifacts_role_idx
        ON ai_experience_artifacts (experience_id, role, created_at ASC);

      CREATE TABLE ai_experience_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        experience_id uuid NOT NULL,
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        kind text NOT NULL CHECK (char_length(kind) BETWEEN 1 AND 80),
        label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 240),
        detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object'),
        created_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (experience_id, organization_id)
          REFERENCES ai_experiences(id, organization_id) ON DELETE CASCADE
      );

      CREATE INDEX ai_experience_events_timeline_idx
        ON ai_experience_events (experience_id, created_at ASC);

      CREATE TABLE ai_choice_responses (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        experience_id uuid NOT NULL,
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        tool_call_id text NOT NULL CHECK (char_length(tool_call_id) BETWEEN 1 AND 200),
        question text NOT NULL CHECK (char_length(question) BETWEEN 1 AND 1000),
        selection text NOT NULL CHECK (selection IN ('SINGLE', 'MULTIPLE')),
        options jsonb NOT NULL CHECK (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) >= 2),
        answer jsonb NOT NULL CHECK (jsonb_typeof(answer) = 'array'),
        answered_by uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (experience_id, tool_call_id),
        FOREIGN KEY (experience_id, organization_id)
          REFERENCES ai_experiences(id, organization_id) ON DELETE CASCADE,
        FOREIGN KEY (answered_by, organization_id) REFERENCES principals(id, organization_id)
      );
    `,
  },
];
