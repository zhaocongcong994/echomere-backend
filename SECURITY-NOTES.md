# Security notes

## 2026-08-29 dependency audit

The integration snapshot builds and passes its test suites, but it is not yet approved for a public production deployment.

- `apps/front`: `npm audit --omit=dev --audit-level=high` reports three high-severity production dependency findings involving the pinned Next.js tree and transitive PostCSS/sharp packages.
- `apps/backend`: the same audit reports a high-severity `deepmerge-ts` advisory through the pinned Prisma toolchain.
- `services/agent`: `npm ci` reports zero known vulnerabilities.

Do not run `npm audit fix --force` blindly. The proposed changes move packages outside their declared ranges and may be breaking. Resolve the upgrades in the upstream Front and Backend repositories, run their own regression suites, then sync the reviewed commits into `integration/full-platform`.

Before any deployment, rotate the model API key used during local development and provide all secrets through the deployment platform rather than committed files.
