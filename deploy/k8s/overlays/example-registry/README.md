# example-registry overlay

Template for clusters that pull images from a remote registry rather than
building locally.

## What to change

1. In `kustomization.yaml`, replace every `ghcr.io/your-org/journeyman-*`
   and `REPLACE_ME` with your real registry, org, and image tag.
2. If your registry is private, add an `imagePullSecrets` patch or set
   the secret on the namespace's default ServiceAccount.
3. Replace the inherited `journeyman-secrets` Secret with one sourced
   from your secrets store (Sealed Secrets, External Secrets, Vault, etc.).
4. Patch `Ingress` if your cluster's ingress class isn't `nginx`.
5. Add resource requests/limits, HPAs, and PodDisruptionBudgets as needed.

## Render

    kubectl kustomize deploy/k8s/overlays/example-registry
