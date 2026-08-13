# Changesets

Changesets record intended package-version and changelog changes independently for the five public QARAA packages. The configuration does not publish packages; publishing remains disabled and requires separate authorization and automation.

Package versions and the serialized protocol version are independent. Releasing any package does not change `PROTOCOL_VERSION`. A breaking serialized-contract change requires a new protocol version and conformance fixtures, regardless of the package-version bump.

When release automation is introduced, add one Markdown changeset per user-visible package change and select only the packages whose published API or behavior changed.
