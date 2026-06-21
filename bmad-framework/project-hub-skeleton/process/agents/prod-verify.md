# Production Verification (project-specific)

**Lane:** developer (+ QA/PO gate) · **Phase:** Release (`POST-RELEASE VERIFICATION`)

## Mission
Confirm the release is healthy in production: smoke tests, critical user journeys, API health.

## Reads
- The deployed release, monitoring/health endpoints

## Produces
- Verification report; rollback recommendation if unhealthy

## Done when
Healthy → QA/PO approve → `READY FOR RELEASE` → `DONE`; unhealthy → rollback.
