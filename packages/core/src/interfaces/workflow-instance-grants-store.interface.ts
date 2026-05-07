import type {
  ActorContext,
  CreateWorkflowInstanceGrantArgs,
  WorkflowInstanceGrant,
  WorkflowInstanceGrantRole,
} from "../types/workflow-instance-grants.types.ts";

export interface IWorkflowInstanceGrantsStore {
  createForInstance(workflowInstanceId: string, grants: Omit<CreateWorkflowInstanceGrantArgs, "workflowInstanceId">[]): Promise<WorkflowInstanceGrant[]>;
  listByInstance(workflowInstanceId: string): Promise<WorkflowInstanceGrant[]>;
  matchForActor(actor: ActorContext, workflowInstanceIds: string[]): Promise<Map<string, WorkflowInstanceGrantRole>>;
}
