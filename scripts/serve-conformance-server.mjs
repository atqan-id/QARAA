/** Deterministic wrapper around the actual QARAA TypeScript server. @license Apache-2.0 */
import { readFile } from 'node:fs/promises';
const check = process.argv.includes('--check');
function positiveOption(name) {
  const index=process.argv.indexOf(name);if(index<0)return undefined;const value=Number(process.argv[index+1]);if(!Number.isSafeInteger(value)||value<1)throw new TypeError(`${name} requires a positive integer`);return value;
}
const maxSessions=positiveOption('--max-sessions');
const maxSubscribers=positiveOption('--max-subscribers');
const shutdownAfterMs=positiveOption('--shutdown-after-ms');
const corpus = JSON.parse(await readFile(new URL('../conformance/v1/valid/minimal-corpus.json', import.meta.url)));
if (check) {
  if (!corpus.corpusId || !Array.isArray(corpus.symbols)) throw new Error('conformance corpus is invalid');
  console.log(JSON.stringify({ ok: true, implementation: '@atqan/qaraa-server', host: '127.0.0.1', port: 0 }));
} else {
  const { createQaraaServer } = await import('../packages/server/dist/index.mjs');
  let sequence = 0;
  const server = createQaraaServer({ corpus, createSessionId: () => `conformance-${++sequence}`, ...(maxSessions===undefined?{}:{maxSessions}), ...(maxSubscribers===undefined?{}:{maxSubscribers}) });
  const address = await server.listen({ host: '127.0.0.1', port: 0 });
  console.log(JSON.stringify({ ready: true, address }));
  if(shutdownAfterMs!==undefined)setTimeout(async()=>{await server.close();process.exit(0)},shutdownAfterMs).unref();
  const stop = async () => { await server.close(); process.exit(0); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
}
