# Users & Identity

## Overview

Journeyman uses JWT-based authentication. Users belong to orgs and hold a role within each org (`user` or `admin`). The platform also supports a cross-org **platform admin** role set at bootstrap time. For programmatic access (CI/CD pipelines, webhooks, scripts) the API supports long-lived **API tokens** that are separate from session JWTs.

## Bootstrap: First Admin User

On a fresh install, run the bootstrap CLI to create the first platform admin and initial org:

```bash
npm run migrate            # run database migrations first
npx journeyman-bootstrap   # creates first org + admin user
```

Follow the prompts to set the admin email and password. After bootstrap completes, this user can create additional users and orgs through the admin UI or API.

## Authentication

### Login

```http
POST /auth/login
Content-Type: application/json

{ "email": "user@example.com", "password": "..." }
```

Returns a signed JWT access token. Include it on subsequent requests:

```
Authorization: Bearer <jwt>
```

JWTs expire (typically 24 h). Re-authenticate via `POST /auth/login` to obtain a fresh token.

### API Tokens

Long-lived tokens for scripts and CI/CD — they do not expire unless manually revoked.

- **UI**: `/me/api-tokens`
- **API**: `POST /api-tokens`

Pass an API token the same way as a JWT:

```
Authorization: Bearer <api-token>
```

## User Management

Admins manage users via the UI at `/admin/users` or via the following endpoints:

| Method | Path | Description |
|---|---|---|
| `GET` | `/users` | List users in your org |
| `POST` | `/users` | Create a new user |
| `GET` | `/users/:id` | Get user details |
| `PUT` | `/users/:id` | Update user (name, role) |
| `DELETE` | `/users/:id` | Deactivate user |

## Roles

| Role | Capabilities |
|---|---|
| `user` | Create and edit own flows, runs, secrets, MCPs, skills, and custom phases |
| `admin` | All `user` permissions, plus manage org users, org-scoped resources, and org settings |
| Platform admin | Cross-org access; assigned via the bootstrap CLI only — not manageable through the normal user API |

## Orgs

Each Journeyman deployment can host multiple orgs. A user belongs to one org. Org-scoped resources — secrets, MCP instances, skills, and custom phases — are shared among all members of that org.

Org management endpoints are available under `/orgs` and are accessible to platform admins and, for their own org, to org admins.

## Password Change

Users can update their own password:

- **UI**: `/me/password`
- **API**: `PUT /me/password` with `{ currentPassword, newPassword }`

Passwords are stored as bcrypt hashes; plaintext is never persisted.

## Package Reference

`@journeyman/identity` exports:

| Export | Description |
|---|---|
| `middleware` | Express middleware that validates the `Authorization` header (JWT or API token) and attaches `req.user` |
| `createJwt` | Signs a new JWT for a given user payload |
| `verifyJwt` | Verifies and decodes a JWT, throws on invalid/expired tokens |
| `registerIdentityRoutes` | Mounts all identity routers (`/auth`, `/users`, `/orgs`, `/api-tokens`, `/admin/users`, etc.) onto an Express app |
| `routes/auth` | Login and session endpoints |
| `routes/users` | User CRUD (org-scoped) |
| `routes/user-management` | Admin user management helpers |
| `routes/orgs` | Org CRUD |
| `routes/api-tokens` | API token creation and revocation |
| `routes/admin-platform` | Platform-admin endpoints |
| `routes/bootstrap` | One-time bootstrap endpoint (disabled after first use) |
