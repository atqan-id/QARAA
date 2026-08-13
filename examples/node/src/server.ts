/** Embeddable server lifecycle example. @license Apache-2.0 */
import { createQaraaServer } from '@atqan/qaraa-server'; import { exampleCorpus } from '../../shared/src/fixture.ts';
export function createExampleServer(){return createQaraaServer({corpus:exampleCorpus});}
