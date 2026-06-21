# Deployment (project-specific)

**Lane:** developer · **Phase:** Release (`TO BE DEPLOYED`)

## Mission
Trigger CI/CD pipelines and manage feature flags to deploy the release.

## Reads
- `repos/registry.yaml`, the release candidate, deploy config

## Produces
- Deployment run + result; flag state

## Done when
Deploy succeeds → `POST-RELEASE VERIFICATION`; failure → escalate.
