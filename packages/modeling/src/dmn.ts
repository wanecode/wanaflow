/// <reference path="./dmn-moddle.d.ts" />
import { evaluate, parseExpression, parseUnaryTests, unaryTest } from "@bpmn-io/feelin";
import { DmnModdle } from "dmn-moddle";

import { BpmnSourceError } from "./types";
import type {
  BpmnElementReference,
  DmnDecisionDefinition,
  DmnEvaluationResult,
  DmnValidationResult,
  RuntimeJsonObject,
  RuntimeJsonValue,
  ValidationIssue,
} from "./types";

const MAX_DMN_SOURCE_BYTES = 2 * 1024 * 1024;
const STABLE_NAME = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/;
const NON_DETERMINISTIC_FEEL = /\b(?:now|today)\s*\(/i;
const SUPPORTED_TYPES = new Set(["string", "boolean", "number"]);

type Expression = { id?: string; text?: string; typeRef?: string };
type DmnInput = { id?: string; label?: string; inputExpression?: Expression };
type DmnOutput = { id?: string; name?: string; label?: string; typeRef?: string };
type DmnRule = { id?: string; description?: string; inputEntry?: Expression[]; outputEntry?: Expression[] };
type DecisionTable = {
  $type?: string;
  id?: string;
  hitPolicy?: string;
  input?: DmnInput[];
  output?: DmnOutput[];
  rule?: DmnRule[];
};
type Decision = { $type?: string; id?: string; name?: string; decisionLogic?: DecisionTable };
type Definitions = { $type?: string; id?: string; drgElement?: Decision[] };

function issue(code: string, message: string, elementId?: string): ValidationIssue {
  return { code, severity: "ERROR", message, ...(elementId ? { elementId } : {}) };
}

function safeSource(source: string) {
  const bytes = Buffer.byteLength(source, "utf8");
  if (!bytes) throw new BpmnSourceError("EMPTY_SOURCE", "DMN source cannot be empty.");
  if (bytes > MAX_DMN_SOURCE_BYTES) {
    throw new BpmnSourceError("SOURCE_TOO_LARGE", `DMN source exceeds the ${MAX_DMN_SOURCE_BYTES}-byte limit.`);
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) {
    throw new BpmnSourceError("UNSAFE_XML", "DTD and entity declarations are not accepted.");
  }
}

async function parseDmn(source: string): Promise<Definitions> {
  safeSource(source);
  try {
    const parsed = await new DmnModdle().fromXML(source);
    return parsed.rootElement as Definitions;
  } catch (error) {
    throw new BpmnSourceError(
      "INVALID_DMN_XML",
      error instanceof Error ? error.message : "The DMN XML could not be parsed.",
    );
  }
}

function deterministicFeel(expression: string, elementId: string, kind: "expression" | "unary") {
  if (NON_DETERMINISTIC_FEEL.test(expression)) {
    throw new BpmnSourceError(
      "NON_DETERMINISTIC_FEEL",
      `DMN element ${elementId} uses a time-dependent FEEL function that is outside the deterministic profile.`,
    );
  }
  try {
    if (kind === "unary") parseUnaryTests(expression, {}, undefined);
    else parseExpression(expression, {}, undefined);
  } catch (error) {
    throw new BpmnSourceError(
      "INVALID_FEEL_EXPRESSION",
      `DMN element ${elementId} contains invalid FEEL: ${error instanceof Error ? error.message : expression}`,
    );
  }
}

function supportedType(value: string | undefined, elementId: string) {
  const type = value?.replace(/^feel:/, "") || "string";
  if (!SUPPORTED_TYPES.has(type)) {
    throw new BpmnSourceError(
      "UNSUPPORTED_DMN_TYPE",
      `DMN element ${elementId} uses ${type}; the current profile supports string, boolean, and number only.`,
    );
  }
  return type as "string" | "boolean" | "number";
}

export async function parseDmnDecision(source: string): Promise<DmnDecisionDefinition> {
  const definitions = await parseDmn(source);
  if (definitions.$type !== "dmn:Definitions") {
    throw new BpmnSourceError("INVALID_DMN_ROOT", "DMN source must contain a definitions root.");
  }
  const decisions = (definitions.drgElement ?? []).filter((element) => element.$type === "dmn:Decision");
  if (decisions.length !== 1) {
    throw new BpmnSourceError(
      "DMN_DECISION_COUNT",
      `The current profile requires exactly one decision per artifact; found ${decisions.length}.`,
    );
  }
  const decision = decisions[0];
  if (!decision.id || !decision.name?.trim()) {
    throw new BpmnSourceError("DMN_DECISION_IDENTITY_REQUIRED", "The decision needs a stable ID and a visible name.");
  }
  const table = decision.decisionLogic;
  if (table?.$type !== "dmn:DecisionTable" || !table.id) {
    throw new BpmnSourceError("DMN_DECISION_TABLE_REQUIRED", `Decision ${decision.id} must contain one decision table.`);
  }
  const hitPolicy = (table.hitPolicy ?? "UNIQUE").toUpperCase();
  if (hitPolicy !== "UNIQUE" && hitPolicy !== "FIRST") {
    throw new BpmnSourceError(
      "UNSUPPORTED_DMN_HIT_POLICY",
      `Decision ${decision.id} uses ${hitPolicy}; the current profile supports UNIQUE and FIRST only.`,
    );
  }
  if (!table.input?.length || !table.output?.length || !table.rule?.length) {
    throw new BpmnSourceError(
      "DMN_TABLE_CONTENT_REQUIRED",
      `Decision ${decision.id} needs at least one input, output, and rule.`,
    );
  }
  const inputNames = new Set<string>();
  const inputs = table.input.map((input, index) => {
    const expression = input.inputExpression?.text?.trim();
    const id = input.id ?? `input-${index + 1}`;
    if (!expression || !STABLE_NAME.test(expression)) {
      throw new BpmnSourceError(
        "DMN_INPUT_NAME_REQUIRED",
        `Input ${id} must use a stable top-level context name such as amount or riskScore.`,
      );
    }
    if (inputNames.has(expression)) {
      throw new BpmnSourceError("DMN_INPUT_NAME_DUPLICATE", `Decision input ${expression} is duplicated.`);
    }
    inputNames.add(expression);
    return {
      id,
      name: expression,
      label: input.label?.trim() || expression,
      type: supportedType(input.inputExpression?.typeRef, id),
    };
  });
  const outputNames = new Set<string>();
  const outputs = table.output.map((output, index) => {
    const name = output.name?.trim();
    const id = output.id ?? `output-${index + 1}`;
    if (!name || !STABLE_NAME.test(name)) {
      throw new BpmnSourceError("DMN_OUTPUT_NAME_REQUIRED", `Output ${id} needs a stable name such as approved.`);
    }
    if (outputNames.has(name)) {
      throw new BpmnSourceError("DMN_OUTPUT_NAME_DUPLICATE", `Decision output ${name} is duplicated.`);
    }
    outputNames.add(name);
    return {
      id,
      name,
      label: output.label?.trim() || name,
      type: supportedType(output.typeRef, id),
    };
  });
  const rules = table.rule.map((rule, index) => {
    const id = rule.id ?? `rule-${index + 1}`;
    if ((rule.inputEntry?.length ?? 0) !== inputs.length || (rule.outputEntry?.length ?? 0) !== outputs.length) {
      throw new BpmnSourceError(
        "DMN_RULE_ARITY_MISMATCH",
        `Rule ${id} must contain ${inputs.length} input cells and ${outputs.length} output cells.`,
      );
    }
    const inputEntries = rule.inputEntry!.map((entry) => entry.text?.trim() || "-");
    const outputEntries = rule.outputEntry!.map((entry) => entry.text?.trim() || "null");
    inputEntries.filter((entry) => entry !== "-").forEach((entry) => deterministicFeel(entry, id, "unary"));
    outputEntries.forEach((entry) => deterministicFeel(entry, id, "expression"));
    return { id, description: rule.description?.trim() || null, inputEntries, outputEntries };
  });
  return {
    id: decision.id,
    name: decision.name.trim(),
    tableId: table.id,
    hitPolicy,
    inputs,
    outputs,
    rules,
  };
}

export async function validateDmnXml(source: string): Promise<DmnValidationResult> {
  const issues: ValidationIssue[] = [];
  let decision: DmnDecisionDefinition | null = null;
  try {
    decision = await parseDmnDecision(source);
  } catch (error) {
    issues.push(issue(
      error instanceof BpmnSourceError ? error.code : "INVALID_DMN",
      error instanceof Error ? error.message : "The DMN source is invalid.",
    ));
  }
  return {
    status: issues.length ? "INVALID" : "VALID",
    profile: "wanaflow-dmn-table@1",
    decision,
    issues,
  };
}

export async function listDmnElements(source: string): Promise<BpmnElementReference[]> {
  const decision = await parseDmnDecision(source);
  return [
    { id: decision.id, name: decision.name, type: "Decision" },
    { id: decision.tableId, name: `${decision.name} table`, type: "DecisionTable" },
    ...decision.rules.map((rule, index) => ({
      id: rule.id,
      name: rule.description || `Rule ${index + 1}`,
      type: "DecisionRule",
    })),
  ];
}

function jsonValue(value: unknown, label: string): RuntimeJsonValue {
  if (value === undefined) throw new BpmnSourceError("DMN_OUTPUT_UNDEFINED", `${label} evaluated to undefined.`);
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new BpmnSourceError("DMN_OUTPUT_NOT_JSON", `${label} is not JSON serializable.`);
  }
  if (serialized === undefined) throw new BpmnSourceError("DMN_OUTPUT_NOT_JSON", `${label} is not JSON serializable.`);
  return JSON.parse(serialized) as RuntimeJsonValue;
}

export function evaluateParsedDmnDecision(
  decision: DmnDecisionDefinition,
  input: RuntimeJsonObject,
): DmnEvaluationResult {
  for (const column of decision.inputs) {
    if (!Object.hasOwn(input, column.name)) {
      throw new BpmnSourceError("DMN_INPUT_REQUIRED", `Decision ${decision.name} requires input ${column.name}.`);
    }
  }
  const matchingRules = decision.rules.filter((rule) => rule.inputEntries.every((entry, index) => {
    if (entry === "-") return true;
    const tested = unaryTest(entry, { ...input, "?": input[decision.inputs[index].name] });
    if (tested.warnings.length) {
      throw new BpmnSourceError("DMN_FEEL_EVALUATION_FAILED", tested.warnings.map((warning) => warning.message).join("; "));
    }
    return tested.value === true;
  }));
  if (decision.hitPolicy === "UNIQUE" && matchingRules.length > 1) {
    throw new BpmnSourceError(
      "DMN_UNIQUE_HIT_VIOLATION",
      `Decision ${decision.name} matched more than one rule under UNIQUE hit policy.`,
    );
  }
  const selected = decision.hitPolicy === "FIRST" ? matchingRules.slice(0, 1) : matchingRules;
  if (!selected.length) {
    return {
      decisionId: decision.id,
      decisionName: decision.name,
      hitPolicy: decision.hitPolicy,
      matchedRuleIds: [],
      output: null,
    };
  }
  const rule = selected[0];
  const output: RuntimeJsonObject = {};
  rule.outputEntries.forEach((expression, index) => {
    const evaluated = evaluate(expression, input);
    if (evaluated.warnings.length) {
      throw new BpmnSourceError("DMN_FEEL_EVALUATION_FAILED", evaluated.warnings.map((warning) => warning.message).join("; "));
    }
    output[decision.outputs[index].name] = jsonValue(evaluated.value, `Output ${decision.outputs[index].name}`);
  });
  return {
    decisionId: decision.id,
    decisionName: decision.name,
    hitPolicy: decision.hitPolicy,
    matchedRuleIds: selected.map((entry) => entry.id),
    output,
  };
}

export async function evaluateDmnDecision(
  source: string,
  input: RuntimeJsonObject,
): Promise<DmnEvaluationResult> {
  return evaluateParsedDmnDecision(await parseDmnDecision(source), input);
}
