import {
  createArtifact,
  DuplicateResourceError,
  findAiExperienceArtifact,
  getAiExperience,
  linkAiExperienceArtifact,
  recordAiExperienceEvent,
  saveArtifactRevision,
  type Artifact,
} from "@wanaflow/db";
import {
  generateExperienceBpmn,
  generateExperienceDmn,
  generateExperienceForm,
  listFormFieldKeys,
  parseDmnDecision,
  parseFormSource,
  validateBpmnXml,
  validateDmnXml,
  validateFormSource,
} from "@wanaflow/modeling";

import { apiError, apiJson, readJson } from "@/lib/server/api-response";
import { shapeAiArtifactSchema } from "@/lib/server/api-schemas";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export const dynamic = "force-dynamic";

function experienceScopedKey(key: string, experienceId: string) {
  const suffix = experienceId.replaceAll("-", "").slice(0, 8);
  const stem = key.slice(0, 63 - suffix.length - 1).replace(/-+$/g, "");
  return `${stem}-${suffix}`;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ experienceId: string }> },
) {
  try {
    const [{ experienceId }, context, body] = await Promise.all([
      params,
      requirePrincipalContext(request, "artifact:create"),
      readJson(request).then((value) => shapeAiArtifactSchema.parse(value)),
    ]);
    const experience = await getAiExperience(context, experienceId);
    const compiledBody = body.kind === "MAIN"
      ? {
          ...body,
          steps: await Promise.all(body.steps.map(async (step) => {
            if (step.kind === "HUMAN" && step.formKey) {
              const form = await findAiExperienceArtifact(context, experienceId, "FORM", step.formKey);
              if (!form) return step;
              const fields = listFormFieldKeys(parseFormSource(form.revision.source));
              const outputMappings = new Map(
                (step.formOutputMappings ?? []).map((mapping) => [mapping.formField, mapping.processVariable]),
              );
              const fieldSet = new Set(fields);
              return {
                ...step,
                formInputMappings: (step.formInputMappings ?? []).filter((mapping) => fieldSet.has(mapping.formField)),
                formOutputMappings: fields.map((formField) => ({
                  formField,
                  processVariable: outputMappings.get(formField) ?? formField,
                })),
              };
            }
            if (step.kind === "DECISION" && step.decisionKey) {
              const artifact = await findAiExperienceArtifact(context, experienceId, "DECISION", step.decisionKey);
              if (!artifact) return step;
              const decision = await parseDmnDecision(artifact.revision.source);
              const inputMappings = new Map(
                (step.decisionInputMappings ?? []).map((mapping) => [mapping.decisionInput, mapping.processVariable]),
              );
              const outputMappings = new Map(
                (step.decisionOutputMappings ?? []).map((mapping) => [mapping.decisionOutput, mapping.processVariable]),
              );
              return {
                ...step,
                decisionInputMappings: decision.inputs.map((input) => ({
                  decisionInput: input.name,
                  processVariable: inputMappings.get(input.name) ?? input.name,
                })),
                decisionOutputMappings: decision.outputs.map((output) => ({
                  decisionOutput: output.name,
                  processVariable: outputMappings.get(output.name) ?? output.name,
                })),
              };
            }
            return step;
          })),
        }
      : body;
    const source = compiledBody.kind === "MAIN"
      ? generateExperienceBpmn(compiledBody)
      : compiledBody.kind === "FORM"
        ? generateExperienceForm(compiledBody)
        : generateExperienceDmn(compiledBody);
    const validation = body.kind === "MAIN"
      ? await validateBpmnXml(source)
      : body.kind === "FORM"
        ? validateFormSource(source)
        : await validateDmnXml(source);
    if (validation.status === "INVALID") {
      return apiJson({
        error: {
          code: "AI_ARTIFACT_INVALID",
          message: "The proposed artifact did not pass Wanaflow validation.",
          issues: validation.issues,
        },
      }, { status: 422 });
    }
    const role = body.kind;
    const existing = await findAiExperienceArtifact(
      context,
      experienceId,
      role,
      role === "MAIN" ? undefined : body.key,
    );
    const type = body.kind === "MAIN" ? "BPMN_PROCESS" : body.kind === "FORM" ? "FORM" : "DMN_DECISION";
    const action = existing ? "updated" : "created";
    let artifact: Artifact;
    if (existing) {
      artifact = (await saveArtifactRevision({
          organizationId: context.organization.id,
          artifactId: existing.id,
          principalId: context.principal.id,
          baseRevisionId: existing.revision.id,
          source,
      })).artifact;
    } else {
      const create = (key: string) => createArtifact({
        organizationId: context.organization.id,
        projectId: experience.projectId,
        principalId: context.principal.id,
        key,
        name: body.name,
        type,
        source,
      });
      try {
        artifact = await create(body.key);
      } catch (error) {
        if (!(error instanceof DuplicateResourceError) || error.field !== "key") throw error;
        artifact = await create(experienceScopedKey(body.key, experienceId));
      }
    }
    if (!existing) await linkAiExperienceArtifact(context, experienceId, artifact.id, role);
    await recordAiExperienceEvent(context, experienceId, {
      kind: `ARTIFACT_${action.toUpperCase()}`,
      label: `${body.name} ${action}`,
      detail: {
        artifactId: artifact.id,
        artifactType: artifact.type,
        role,
        revisionId: artifact.revision.id,
        revisionNumber: artifact.revision.number,
        validationStatus: artifact.revision.validation.status,
      },
    });
    return apiJson({ data: {
      action,
      role,
      artifact,
      validation: artifact.revision.validation,
    } }, { status: existing ? 200 : 201 });
  } catch (error) {
    return apiError(error);
  }
}
