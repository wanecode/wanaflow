export const employeeOnboardingBpmn = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  xmlns:wanaflow="https://wanaflow.dev/schema/bpmn"
  id="Definitions_EmployeeOnboarding"
  targetNamespace="https://wanaflow.dev/bpmn">
  <bpmn:process id="employee-onboarding" name="Employee onboarding" isExecutable="true">
    <bpmn:startEvent id="StartEvent_Employee" name="Employee hired">
      <bpmn:outgoing>Flow_Start_Collect</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:userTask id="Task_CollectDetails" name="Collect employee details">
      <bpmn:incoming>Flow_Start_Collect</bpmn:incoming>
      <bpmn:outgoing>Flow_Collect_Equipment</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:serviceTask id="Task_ProvisionEquipment" name="Provision equipment" wanaflow:jobType="equipment.provision" wanaflow:jobInputMapping="{&quot;employeeId&quot;:&quot;employeeId&quot;}" wanaflow:jobHeaders="{&quot;owner&quot;:&quot;workplace&quot;}" wanaflow:jobLockDuration="PT30S" wanaflow:jobMaxAttempts="3" wanaflow:jobRetryBackoff="PT10S">
      <bpmn:incoming>Flow_Collect_Equipment</bpmn:incoming>
      <bpmn:outgoing>Flow_Equipment_Approve</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:userTask id="Task_ManagerApproval" name="Manager approval">
      <bpmn:incoming>Flow_Equipment_Approve</bpmn:incoming>
      <bpmn:outgoing>Flow_Approve_Welcome</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:serviceTask id="Task_SendWelcome" name="Send welcome pack" wanaflow:jobType="welcome.send" wanaflow:jobInputMapping="{&quot;employeeId&quot;:&quot;employeeId&quot;}" wanaflow:jobHeaders="{&quot;channel&quot;:&quot;email&quot;}" wanaflow:jobLockDuration="PT30S" wanaflow:jobMaxAttempts="3" wanaflow:jobRetryBackoff="PT10S">
      <bpmn:incoming>Flow_Approve_Welcome</bpmn:incoming>
      <bpmn:outgoing>Flow_Welcome_End</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:endEvent id="EndEvent_Ready" name="Ready for day one">
      <bpmn:incoming>Flow_Welcome_End</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_Start_Collect" sourceRef="StartEvent_Employee" targetRef="Task_CollectDetails" />
    <bpmn:sequenceFlow id="Flow_Collect_Equipment" sourceRef="Task_CollectDetails" targetRef="Task_ProvisionEquipment" />
    <bpmn:sequenceFlow id="Flow_Equipment_Approve" sourceRef="Task_ProvisionEquipment" targetRef="Task_ManagerApproval" />
    <bpmn:sequenceFlow id="Flow_Approve_Welcome" sourceRef="Task_ManagerApproval" targetRef="Task_SendWelcome" />
    <bpmn:sequenceFlow id="Flow_Welcome_End" sourceRef="Task_SendWelcome" targetRef="EndEvent_Ready" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_EmployeeOnboarding">
    <bpmndi:BPMNPlane id="BPMNPlane_EmployeeOnboarding" bpmnElement="employee-onboarding">
      <bpmndi:BPMNShape id="StartEvent_Employee_di" bpmnElement="StartEvent_Employee">
        <dc:Bounds x="110" y="242" width="36" height="36" />
        <bpmndi:BPMNLabel><dc:Bounds x="88" y="285" width="80" height="27" /></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_CollectDetails_di" bpmnElement="Task_CollectDetails">
        <dc:Bounds x="205" y="220" width="130" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_ProvisionEquipment_di" bpmnElement="Task_ProvisionEquipment">
        <dc:Bounds x="390" y="220" width="140" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_ManagerApproval_di" bpmnElement="Task_ManagerApproval">
        <dc:Bounds x="585" y="220" width="130" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_SendWelcome_di" bpmnElement="Task_SendWelcome">
        <dc:Bounds x="770" y="220" width="130" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="EndEvent_Ready_di" bpmnElement="EndEvent_Ready">
        <dc:Bounds x="955" y="242" width="36" height="36" />
        <bpmndi:BPMNLabel><dc:Bounds x="930" y="285" width="88" height="27" /></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_Start_Collect_di" bpmnElement="Flow_Start_Collect">
        <di:waypoint x="146" y="260" /><di:waypoint x="205" y="260" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_Collect_Equipment_di" bpmnElement="Flow_Collect_Equipment">
        <di:waypoint x="335" y="260" /><di:waypoint x="390" y="260" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_Equipment_Approve_di" bpmnElement="Flow_Equipment_Approve">
        <di:waypoint x="530" y="260" /><di:waypoint x="585" y="260" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_Approve_Welcome_di" bpmnElement="Flow_Approve_Welcome">
        <di:waypoint x="715" y="260" /><di:waypoint x="770" y="260" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_Welcome_End_di" bpmnElement="Flow_Welcome_End">
        <di:waypoint x="900" y="260" /><di:waypoint x="955" y="260" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
