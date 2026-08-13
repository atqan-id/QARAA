/** Minimal local JavaScript lifecycle example. @license Apache-2.0 */
import { createLocalSession } from '@atqan/qaraa-client'; import { exampleCorpus, exampleObservation } from '../../shared/src/fixture.ts';
export async function runLocalExample(): Promise<number> { const session=createLocalSession({corpus:exampleCorpus}); try{return (await session.submit(exampleObservation)).revision;} finally {await session.close();} }
