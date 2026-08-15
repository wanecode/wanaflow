function xml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function blankDmnDecision(key: string, name: string) {
  const safeKey = key.replace(/[^A-Za-z0-9_]/g, "_");
  return `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" xmlns:dmndi="https://www.omg.org/spec/DMN/20191111/DMNDI/" xmlns:dc="http://www.omg.org/spec/DMN/20180521/DC/" xmlns:di="http://www.omg.org/spec/DMN/20180521/DI/" id="Definitions_${safeKey}" name="${xml(name)}" namespace="https://wanaflow.dev/decisions/${xml(key)}">
  <decision id="Decision_${safeKey}" name="${xml(name)}">
    <decisionTable id="DecisionTable_${safeKey}" hitPolicy="UNIQUE">
      <input id="Input_1" label="Input">
        <inputExpression id="InputExpression_1" typeRef="string"><text>input</text></inputExpression>
      </input>
      <output id="Output_1" name="result" label="Result" typeRef="string" />
      <rule id="Rule_1">
        <inputEntry id="InputEntry_1"><text>-</text></inputEntry>
        <outputEntry id="OutputEntry_1"><text>"review"</text></outputEntry>
      </rule>
    </decisionTable>
  </decision>
</definitions>`;
}
