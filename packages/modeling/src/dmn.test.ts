import { describe, expect, it } from "vitest";

import { evaluateDmnDecision, parseDmnDecision, validateDmnXml } from "./index";

const decisionSource = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" id="Definitions_approval" name="Expense decisions" namespace="https://wanaflow.dev/test/decisions">
  <decision id="Decision_expense_approval" name="Expense approval">
    <decisionTable id="DecisionTable_expense_approval" hitPolicy="UNIQUE">
      <input id="Input_amount" label="Amount"><inputExpression id="Expression_amount" typeRef="number"><text>amount</text></inputExpression></input>
      <input id="Input_risk" label="Risk"><inputExpression id="Expression_risk" typeRef="string"><text>risk</text></inputExpression></input>
      <output id="Output_approved" name="approved" label="Approved" typeRef="boolean" />
      <output id="Output_route" name="route" label="Route" typeRef="string" />
      <rule id="Rule_auto"><description>Safe amount</description><inputEntry id="Unary_amount"><text>&lt;= 1000</text></inputEntry><inputEntry id="Unary_risk"><text>"low"</text></inputEntry><outputEntry id="Literal_approved"><text>true</text></outputEntry><outputEntry id="Literal_route"><text>"automatic"</text></outputEntry></rule>
      <rule id="Rule_review"><description>Everything else</description><inputEntry id="Unary_amount_else"><text>-</text></inputEntry><inputEntry id="Unary_risk_else"><text>-</text></inputEntry><outputEntry id="Literal_review"><text>false</text></outputEntry><outputEntry id="Literal_route_review"><text>"manual"</text></outputEntry></rule>
    </decisionTable>
  </decision>
</definitions>`;

describe("DMN decision-table profile", () => {
  it("parses one deterministic UNIQUE decision table", async () => {
    await expect(validateDmnXml(decisionSource)).resolves.toMatchObject({
      status: "VALID",
      profile: "wanaflow-dmn-table@1",
      decision: {
        id: "Decision_expense_approval",
        hitPolicy: "UNIQUE",
        inputs: [{ name: "amount" }, { name: "risk" }],
        outputs: [{ name: "approved" }, { name: "route" }],
      },
    });
    await expect(parseDmnDecision(decisionSource)).resolves.toMatchObject({ rules: [{ id: "Rule_auto" }, { id: "Rule_review" }] });
  });

  it("evaluates a matching rule and returns auditable evidence", async () => {
    const firstOnly = decisionSource.replace(
      '<rule id="Rule_review"><description>Everything else</description><inputEntry id="Unary_amount_else"><text>-</text></inputEntry><inputEntry id="Unary_risk_else"><text>-</text></inputEntry><outputEntry id="Literal_review"><text>false</text></outputEntry><outputEntry id="Literal_route_review"><text>"manual"</text></outputEntry></rule>',
      '<rule id="Rule_review"><description>Everything else</description><inputEntry id="Unary_amount_else"><text>&gt; 1000</text></inputEntry><inputEntry id="Unary_risk_else"><text>-</text></inputEntry><outputEntry id="Literal_review"><text>false</text></outputEntry><outputEntry id="Literal_route_review"><text>"manual"</text></outputEntry></rule>',
    );
    await expect(evaluateDmnDecision(firstOnly, { amount: 500, risk: "low" })).resolves.toEqual({
      decisionId: "Decision_expense_approval",
      decisionName: "Expense approval",
      hitPolicy: "UNIQUE",
      matchedRuleIds: ["Rule_auto"],
      output: { approved: true, route: "automatic" },
    });
  });

  it("rejects UNIQUE ambiguity and time-dependent FEEL", async () => {
    await expect(evaluateDmnDecision(decisionSource, { amount: 500, risk: "low" }))
      .rejects.toMatchObject({ code: "DMN_UNIQUE_HIT_VIOLATION" });
    const timed = decisionSource.replace("<text>true</text>", "<text>today()</text>");
    await expect(validateDmnXml(timed)).resolves.toMatchObject({
      status: "INVALID",
      issues: [expect.objectContaining({ code: "NON_DETERMINISTIC_FEEL" })],
    });
  });
});
