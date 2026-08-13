# Contributing

QARAA is experimental. Changes should preserve its package boundaries, deterministic contracts, and release-safety checks.

## Set up

Use Node 22.12 or later and the pinned pnpm version:

```bash
corepack enable
pnpm install --frozen-lockfile
```

## Develop with tests first

For behavior changes, add a focused test and observe it fail for the expected reason before changing implementation. Then make the smallest implementation change, run the focused test, and run the full relevant suite.

Before requesting review, run:

```bash
pnpm check
pnpm test
pnpm test:conformance
pnpm build
pnpm run audit
pnpm tarball:smoke
pnpm audit --prod --audit-level high
git diff --check
```

The primary runtime compiler must report `Version 7.0.2` from `pnpm exec tsc --version`. The TS6 alias is limited to tools that import the legacy compiler API.

## Contract changes

- Keep `@atqan/qaraa-core` free of transport, browser, recognizer, database, authentication, model-loading, and hosted-service code.
- Keep observations recognizer-neutral and require callers to provide corpus and token mapping.
- Add or update conformance fixtures for protocol changes. A breaking serialized change requires a new protocol version.
- Add a Changeset for public package behavior after release automation exists. Package bumps do not implicitly change `PROTOCOL_VERSION`.
- Do not add models, credentials, private endpoints, or Quran datasets to commits or package archives.
- Do not publish or deploy from a contribution branch.

## Licensing

By contributing intentionally submitted work, you agree that it is provided under Apache License 2.0 as described in [LICENSE](LICENSE). Only contribute material you have the right to submit. Preserve applicable third-party attribution and document any distributed runtime dependency in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
