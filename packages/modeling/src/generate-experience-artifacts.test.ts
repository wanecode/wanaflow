import { describe, expect, it } from "vitest";

import {
  generateExperienceBpmn,
  generateExperienceDmn,
  generateExperienceForm,
} from "./generate-experience-artifacts";
import { validateBpmnXml } from "./validate-bpmn";
import { validateDmnXml } from "./dmn";
import { validateFormSource } from "./forms";

describe("AI experience artifact compilers", () => {
  it("compiles a bounded executable process", async () => {
    const source = generateExperienceBpmn({
      key: "supplier-onboarding",
      name: "Supplier onboarding",
      steps: [
        {
          kind: "HUMAN",
          name: "Review supplier details",
          formKey: "supplier-review",
          formOutputMappings: [{ processVariable: "supplierName", formField: "supplierName" }],
        },
        { kind: "SERVICE", name: "Create supplier record", jobType: "supplier.create" },
        {
          kind: "DECISION",
          name: "Assess risk",
          decisionKey: "supplier-risk",
          decisionInputMappings: [{ decisionInput: "amount", processVariable: "annualAmount" }],
          decisionOutputMappings: [{ processVariable: "riskLevel", decisionOutput: "risk" }],
        },
      ],
    });
    expect(await validateBpmnXml(source)).toMatchObject({ status: "VALID" });
    expect(source).toContain('wanaflow:formKey="supplier-review"');
    expect(source).toContain('wanaflow:outputMapping="{&quot;supplierName&quot;:&quot;supplierName&quot;}"');
    expect(source).toContain('wanaflow:decisionInputMapping="{&quot;amount&quot;:&quot;annualAmount&quot;}"');
    expect(source).toContain('wanaflow:decisionOutputMapping="{&quot;riskLevel&quot;:&quot;risk&quot;}"');
  });

  it("compiles a form-js form", () => {
    const source = generateExperienceForm({
      key: "supplier-request",
      name: "Supplier request",
      fields: [
        { key: "supplierName", label: "Supplier name", type: "textfield", required: true },
        { key: "riskLevel", label: "Risk level", type: "select", options: [
          { label: "Low", value: "low" },
          { label: "High", value: "high" },
        ] },
      ],
    });
    expect(validateFormSource(source)).toMatchObject({ status: "VALID" });
  });

  it("compiles a bounded DMN table", async () => {
    const source = generateExperienceDmn({
      key: "supplier-risk",
      name: "Supplier risk",
      hitPolicy: "UNIQUE",
      inputs: [{ name: "amount", label: "Annual amount", type: "number" }],
      outputs: [{ name: "risk", label: "Risk", type: "string" }],
      rules: [
        { description: "Low", inputEntries: ["< 10000"], outputEntries: ['"low"'] },
        { description: "High", inputEntries: [">= 10000"], outputEntries: ['"high"'] },
      ],
    });
    expect(await validateDmnXml(source)).toMatchObject({ status: "VALID" });
  });
});
