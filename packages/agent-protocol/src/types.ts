export interface ReadinessCheck { name: string; ok: boolean; detail: string; }
export interface ReadinessReply { ready: boolean; checks: ReadinessCheck[]; }
export interface ProvisionRequest { run_id: string; }
export interface ProvisionReply { handle: string; workspace_dir: string; }
export interface ExecRequest { run_id: string; request_json: string; env: Record<string, string>; }
export interface LogLine { line: string; meta_json: string; }
export interface ExecFinal { ok: boolean; structured_json: string; error: string; }
export interface ExecEvent { log?: LogLine; final?: ExecFinal; }
export interface FileChunk { run_id: string; dest_dir: string; tar: Buffer; }
export interface MaterializeReply { ok: boolean; }
export interface DestroyRequest { run_id: string; }
export interface DestroyReply { ok: boolean; }
export interface ListRequest { run_id: string; }
export interface RunInfo { run_id: string; handle: string; workspace_dir: string; }
export interface ListReply { runs: RunInfo[]; }
