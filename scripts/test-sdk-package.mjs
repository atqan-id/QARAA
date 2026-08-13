/** Native SDK gate dispatcher. @license Apache-2.0 */
import { spawnSync } from 'node:child_process';
const commands = {
  python: ['python3', ['-m', 'pytest', '-q'], 'sdk/python'],
  go: ['go', ['test', './...', '-race'], 'sdk/go'],
  dart: ['dart', ['test'], 'sdk/dart'],
};
const selected = process.argv[2];
if (!(selected in commands)) throw new TypeError('usage: test-sdk-package.mjs python|go|dart');
const [command, args, cwd] = commands[selected];
const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
process.exitCode = result.status ?? 1;
