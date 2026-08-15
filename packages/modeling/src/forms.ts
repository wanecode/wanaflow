import type {
  FormFieldError,
  FormValidationResult,
  ValidationIssue,
} from "./types";
import { BpmnSourceError } from "./types";

const MAX_FORM_SOURCE_BYTES = 2 * 1024 * 1024;
const DATA_COMPONENT_TYPES = new Set([
  "checkbox",
  "datetime",
  "number",
  "radio",
  "select",
  "taglist",
  "textarea",
  "textfield",
]);
const SAFE_COMPONENT_TYPES = new Set([
  ...DATA_COMPONENT_TYPES,
  "button",
  "group",
  "separator",
  "spacer",
  "text",
]);

export type FormComponent = {
  id?: string;
  type?: string;
  key?: string;
  label?: string;
  components?: FormComponent[];
  values?: Array<{ label?: string; value?: string }>;
  validate?: {
    required?: boolean;
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
  };
};

export type FormSchema = {
  schemaVersion?: number;
  type: "default";
  id?: string;
  components: FormComponent[];
  [key: string]: unknown;
};

function parseJson(source: string): unknown {
  const bytes = Buffer.byteLength(source, "utf8");
  if (!bytes) throw new BpmnSourceError("EMPTY_SOURCE", "Form source cannot be empty.");
  if (bytes > MAX_FORM_SOURCE_BYTES) {
    throw new BpmnSourceError("SOURCE_TOO_LARGE", `Form source exceeds the ${MAX_FORM_SOURCE_BYTES}-byte limit.`);
  }
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new BpmnSourceError(
      "INVALID_FORM_JSON",
      error instanceof Error ? error.message : "The form source is not valid JSON.",
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function walk(components: FormComponent[], visit: (component: FormComponent) => void) {
  for (const component of components) {
    visit(component);
    if (Array.isArray(component.components)) walk(component.components, visit);
  }
}

export function parseFormSource(source: string): FormSchema {
  const parsed = parseJson(source);
  if (!isRecord(parsed) || parsed.type !== "default" || !Array.isArray(parsed.components)) {
    throw new BpmnSourceError(
      "INVALID_FORM_SCHEMA",
      "A form must be a form-js default schema with a components array.",
    );
  }
  return parsed as FormSchema;
}

export function validateFormSource(source: string): FormValidationResult {
  const schema = parseFormSource(source);
  const issues: ValidationIssue[] = [];
  const keys = new Set<string>();
  const ids = new Set<string>();
  walk(schema.components, (component) => {
    if (!component.type || typeof component.type !== "string") {
      issues.push({ code: "FORM_COMPONENT_TYPE_REQUIRED", severity: "ERROR", message: "Every form component needs a type." });
    } else if (!SAFE_COMPONENT_TYPES.has(component.type)) {
      issues.push({
        code: "FORM_COMPONENT_UNSUPPORTED",
        severity: "ERROR",
        message: `${component.type} is not supported by the wanaflow-form@1 execution profile.`,
        elementId: component.id,
      });
    }
    if (component.id) {
      if (ids.has(component.id)) {
        issues.push({ code: "FORM_COMPONENT_ID_DUPLICATE", severity: "ERROR", message: `Component id ${component.id} is duplicated.`, elementId: component.id });
      }
      ids.add(component.id);
    }
    if (component.type && DATA_COMPONENT_TYPES.has(component.type)) {
      if (!component.key || !/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(component.key)) {
        issues.push({ code: "FORM_FIELD_KEY_REQUIRED", severity: "ERROR", message: "Every data field needs a stable key using letters, numbers, dots, dashes, or underscores.", elementId: component.id });
      } else if (keys.has(component.key)) {
        issues.push({ code: "FORM_FIELD_KEY_DUPLICATE", severity: "ERROR", message: `Field key ${component.key} is duplicated.`, elementId: component.id });
      } else {
        keys.add(component.key);
      }
    }
  });
  if (!keys.size) {
    issues.push({ code: "FORM_DATA_FIELD_REQUIRED", severity: "WARNING", message: "This form has no data fields." });
  }
  return {
    status: issues.some((issue) => issue.severity === "ERROR") ? "INVALID" : "VALID",
    profile: "wanaflow-form@1",
    issues,
  };
}

function empty(value: unknown) {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

export function validateFormSubmission(
  schema: FormSchema,
  data: Record<string, unknown>,
): FormFieldError[] {
  const errors: FormFieldError[] = [];
  const fieldKeys = new Set<string>();
  walk(schema.components, (component) => {
    if (!component.type || !DATA_COMPONENT_TYPES.has(component.type) || !component.key) return;
    fieldKeys.add(component.key);
    const value = data[component.key];
    const validation = component.validate ?? {};
    if (validation.required && empty(value)) {
      errors.push({ key: component.key, message: `${component.label || component.key} is required.` });
      return;
    }
    if (empty(value)) return;
    if (component.type === "number" && typeof value !== "number") {
      errors.push({ key: component.key, message: `${component.label || component.key} must be a number.` });
      return;
    }
    if (component.type === "checkbox" && typeof value !== "boolean") {
      errors.push({ key: component.key, message: `${component.label || component.key} must be true or false.` });
      return;
    }
    if (["textfield", "textarea", "datetime", "radio", "select"].includes(component.type) && typeof value !== "string") {
      errors.push({ key: component.key, message: `${component.label || component.key} must be text.` });
      return;
    }
    const allowedValues = component.values?.map((option) => option.value).filter((option): option is string => typeof option === "string") ?? [];
    if (["radio", "select"].includes(component.type) && allowedValues.length && typeof value === "string" && !allowedValues.includes(value)) {
      errors.push({ key: component.key, message: `${component.label || component.key} is not an allowed option.` });
      return;
    }
    if (component.type === "taglist") {
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
        errors.push({ key: component.key, message: `${component.label || component.key} must be a list of options.` });
        return;
      }
      if (allowedValues.length && value.some((entry) => !allowedValues.includes(entry))) {
        errors.push({ key: component.key, message: `${component.label || component.key} contains an option that is not allowed.` });
        return;
      }
    }
    if (typeof value === "string") {
      if (validation.minLength !== undefined && value.length < validation.minLength) errors.push({ key: component.key, message: `${component.label || component.key} is too short.` });
      if (validation.maxLength !== undefined && value.length > validation.maxLength) errors.push({ key: component.key, message: `${component.label || component.key} is too long.` });
      if (validation.pattern) {
        try {
          if (!new RegExp(validation.pattern).test(value)) errors.push({ key: component.key, message: `${component.label || component.key} has an invalid format.` });
        } catch {
          errors.push({ key: component.key, message: `${component.label || component.key} has an invalid validation pattern.` });
        }
      }
    }
    if (typeof value === "number") {
      if (validation.min !== undefined && value < validation.min) errors.push({ key: component.key, message: `${component.label || component.key} is below the minimum.` });
      if (validation.max !== undefined && value > validation.max) errors.push({ key: component.key, message: `${component.label || component.key} is above the maximum.` });
    }
  });
  for (const key of Object.keys(data)) {
    if (!fieldKeys.has(key)) errors.push({ key, message: `${key} is not a field in this deployed form.` });
  }
  return errors;
}

export function listFormFieldKeys(schema: FormSchema) {
  const keys: string[] = [];
  walk(schema.components, (component) => {
    if (component.type && DATA_COMPONENT_TYPES.has(component.type) && component.key) keys.push(component.key);
  });
  return keys;
}
