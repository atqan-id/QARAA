# Security policy

## Supported versions

QARAA is experimental and has not been published. Security fixes are made on the latest `main` revision; no older package line currently receives a support commitment.

## Report a vulnerability

Do not open a public issue for a suspected vulnerability or include secrets, private endpoints, licensed corpora, model files, or personally identifying recitation data in a report. Use the repository hosting provider’s private vulnerability-reporting feature when it is enabled. If it is unavailable, contact the repository owner through an established private channel and request secure reporting instructions without disclosing exploit details publicly.

Include the affected package and revision, impact, prerequisites, a minimal reproduction using synthetic data, and any suggested mitigation. Remove credentials and proprietary artifacts.

Maintainers should acknowledge reports privately, reproduce them with synthetic fixtures, coordinate a fix and disclosure window, and credit reporters who request attribution. This policy sets process expectations, not a guaranteed response or remediation time.

## Security boundaries

- The core package performs deterministic in-memory processing and has no network, authentication, model-loading, or storage behavior.
- The server is an embeddable in-memory transport and does not implement authentication, authorization, rate limiting, billing, or durable persistence. A deployment must supply those controls at its boundary.
- Callers are responsible for validating the provenance and licensing of corpora, recognition models, and token mappings.
- The release gate checks packed paths and text artifacts for common secret patterns, model/dataset/application material, undeclared runtime imports, and absolute source-map paths. It cannot prove that arbitrary data is non-sensitive; review remains required.
