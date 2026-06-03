import type {
  ExecutionEnvironmentBackend,
  IExecutionEnvironmentRegistry,
  ComputeTargetType,
} from "@journeyman/core";

export class InMemoryExecutionEnvironmentRegistry implements IExecutionEnvironmentRegistry {
  private byType = new Map<ComputeTargetType, ExecutionEnvironmentBackend>();

  register(backend: ExecutionEnvironmentBackend): void {
    if (this.byType.has(backend.type)) {
      throw new Error(`Execution backend '${backend.type}' already registered`);
    }
    this.byType.set(backend.type, backend);
  }

  get(type: ComputeTargetType): ExecutionEnvironmentBackend {
    const backend = this.byType.get(type);
    if (!backend) {
      throw new Error(`No execution backend registered for type '${type}'`);
    }
    return backend;
  }

  available(): ComputeTargetType[] {
    return [...this.byType.keys()];
  }
}
