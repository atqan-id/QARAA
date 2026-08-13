# Framework adapters

Each package accepts an already-created `QaraaSession`. It is safe to import in
SSR because no adapter creates a session, subscribes, opens a connection, or
accesses browser globals at module evaluation. Framework cleanup releases only
its subscription; callers explicitly invoke `close()` to close their session.

All adapters publish the same state contract—`snapshot`, `status`, and `error`—
plus `submit`, `reset`, and `close` actions. The session can be local or remote;
the adapter never changes alignment, confidence, or finding semantics.

| Package | Primitive | Peer range | Tested here | SSR import | Session modes |
| --- | --- | --- | --- | --- | --- |
| `@atqan/qaraa-react` | `useQaraaSession` | React `>=18.3.1 <20` | `19.2.8` | Inert | Local + remote |
| `@atqan/qaraa-preact` | `useQaraaSession` | Preact `>=10.24.3 <11` | `10.29.8` | Inert | Local + remote |
| `@atqan/qaraa-vue` | `useQaraaSession` | Vue `>=3.4.38 <4` | `3.5.41` | Inert | Local + remote |
| `@atqan/qaraa-angular` | `QaraaSessionService` | Angular `>=20.3.27 <23` | `22.1.1` | Inert | Local + remote |
| `@atqan/qaraa-svelte` | `createQaraaStore` | Svelte `>=5.0.5 <6` | `5.56.8` | Inert | Local + remote |
| `@atqan/qaraa-solid` | `createQaraaSession` | Solid `>=1.8.23 <2` | `1.9.14` | Inert | Local + remote |
| `@atqan/qaraa-lit` | `QaraaSessionController` | Lit `>=3.2.1 <4` | `3.3.3` | Inert | Local + remote |

The current-version matrix above is verified by this checkout. The CI
`minimum-peers` job separately installs and checks every documented minimum
before a stable support declaration is accepted.

The repository also builds private, minimal consumers using each actual
toolchain: Vite 8 (React, Preact, Vue, Svelte, Solid, Lit), Angular AOT, Next.js
16.3.0, Nuxt 4.5.2, SvelteKit 2.70.2, and Astro 7.2.1. These examples
demonstrate integration boundaries and are never published or bundled with
model artifacts or credentials.
QARAA package declarations remain compiled with `@typescript/native` 7.0.2.
The Next.js 16.3.0 example alone declares the conventional TypeScript 6.0.2
package because Next's framework type gate requires the standard `tsc` binary;
it is development-only and is absent from every published adapter dependency.

Every adapter is exercised against the shared contract for monotonic revisions,
action failure propagation, caller-owned session lifetime, and cleanup. React
StrictMode and Preact additionally run 100 mount/unmount cycles. The audit scans
both source and emitted bundles for forbidden runtime, server, sibling-adapter,
network, and browser-global dependencies.

## Ownership

```ts
const session = createLocalSession({ corpus });
// Pass `session` into the adapter for your framework.
// Framework teardown unsubscribes; your application owns the final close.
await session.close();
```

This separation prevents development-mode remounts and route transitions from
accidentally terminating a caller-owned session. It also keeps every adapter
safe for server rendering: creating a network transport remains an application
boundary, never an import-time adapter side effect.
