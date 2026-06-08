import type { SandboxType, ExecutionMode, Connectivity } from "@journeyman/core";

export interface SandboxTypeDescriptor {
  type: SandboxType;
  label: string;
  status: "available" | "planned";
  supportedModes: ExecutionMode[];
  supportedConnectivity: Connectivity[];
  summary: string;
}

/**
 * Authoritative metadata for every worker type. `status: "available"` means a
 * backend exists in code (see default-registry). The drift test keeps this in
 * sync with the registered backends. Modes/connectivity for planned types come
 * from the managed-sandboxes design (§4 matrix).
 */
export const SANDBOX_CATALOG: SandboxTypeDescriptor[] = [
  { type: "local", label: "Local (no isolation)", status: "available",
    supportedModes: ["shared"], supportedConnectivity: [],
    summary: "Runs in-process on the host with a shared workspace. No isolation." },
  { type: "docker", label: "Docker (per-instance)", status: "available",
    supportedModes: ["per-instance"], supportedConnectivity: ["push"],
    summary: "Each run gets its own throwaway container and volume." },
  { type: "machine-linux", label: "Linux machine (SSH)", status: "planned",
    supportedModes: ["shared", "per-instance"], supportedConnectivity: ["push", "agent"],
    summary: "A Linux host reached over SSH (push) or via an installed agent." },
  { type: "machine-windows", label: "Windows machine (SSH)", status: "planned",
    supportedModes: ["shared", "per-instance"], supportedConnectivity: ["push", "agent"],
    summary: "A Windows host reached over SSH (push) or via an installed agent." },
  { type: "ecs", label: "AWS ECS", status: "planned",
    supportedModes: ["per-instance"], supportedConnectivity: ["push", "agent"],
    summary: "One ECS task per run via the AWS API." },
  { type: "ec2", label: "AWS EC2", status: "planned",
    supportedModes: ["shared", "per-instance"], supportedConnectivity: ["push", "agent"],
    summary: "An EC2 instance reached over SSH/API." },
  { type: "kubernetes", label: "Kubernetes", status: "planned",
    supportedModes: ["per-instance"], supportedConnectivity: ["push", "agent"],
    summary: "One pod per run via the cluster API." },
  { type: "cloud", label: "Cloud", status: "planned",
    supportedModes: ["per-instance"], supportedConnectivity: ["push", "agent"],
    summary: "A managed cloud runner via its API." },
];
