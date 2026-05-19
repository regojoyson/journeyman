# Kubernetes Deployment

Cluster-agnostic Kustomize manifests for Journeyman.

## Layout

- `base/` — vendor-neutral manifests. Do not edit per-cluster details here.
- `overlays/local/` — single-replica local dev. Uses `imagePullPolicy: IfNotPresent` and a generated Secret.
- `overlays/example-registry/` — template for clusters pulling from a remote registry.

## Quick start (local cluster)

```bash
npm run images:build
# Load images into your cluster if needed (see below)
npm run k8s:up
```

## Loading locally-built images

Most local clusters can't see images from your host's Docker by default. Pick the command for your runtime:

| Cluster | Command |
|---|---|
| Docker Desktop k8s | nothing — uses host Docker |
| Rancher Desktop (containerd / dockerd) | nothing — uses host runtime |
| k3s on this host | nothing — uses host containerd |
| kind | `kind load docker-image journeyman/api-server:dev journeyman/worker:dev journeyman/web:dev journeyman/migrations:dev` |
| minikube | `minikube image load journeyman/api-server:dev` (repeat per image) |

## Hostname

The default Ingress host is `journeyman.local`. Add a hosts entry pointing it to your ingress controller's external IP/loadbalancer.

## Tearing down

```bash
npm run k8s:down
```
