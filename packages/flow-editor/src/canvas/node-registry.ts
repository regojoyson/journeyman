import { StartNode } from "./nodes/StartNode.tsx";
import { EndNode } from "./nodes/EndNode.tsx";
import { StepNode } from "./nodes/StepNode.tsx";
import { GatewayXorNode } from "./nodes/GatewayXorNode.tsx";
import { GatewayAndNode } from "./nodes/GatewayAndNode.tsx";
import { LoopNode } from "./nodes/LoopNode.tsx";
import { SubflowNode } from "./nodes/SubflowNode.tsx";
import { IfNode } from "./nodes/IfNode.tsx";
import { TimerNode } from "./nodes/TimerNode.tsx";
import { HumanTaskNode } from "./nodes/HumanTaskNode.tsx";
import { WebhookWaitNode } from "./nodes/WebhookWaitNode.tsx";
import { JoinNode } from "./nodes/JoinNode.tsx";
import { DefaultEdge } from "./edges/DefaultEdge.tsx";
import { ConditionalEdge } from "./edges/ConditionalEdge.tsx";
import { ErrorEdge } from "./edges/ErrorEdge.tsx";
import { ElseEdge } from "./edges/ElseEdge.tsx";

export const nodeTypes = {
  start: StartNode,
  end: EndNode,
  step: StepNode,
  "gateway-xor": GatewayXorNode,
  "gateway-and": GatewayAndNode,
  loop: LoopNode,
  subflow: SubflowNode,
  if: IfNode,
  timer: TimerNode,
  "human-task": HumanTaskNode,
  "webhook-wait": WebhookWaitNode,
  "join": JoinNode,
};

export const edgeTypes = {
  default: DefaultEdge,
  conditional: ConditionalEdge,
  error: ErrorEdge,
  else: ElseEdge,
};
