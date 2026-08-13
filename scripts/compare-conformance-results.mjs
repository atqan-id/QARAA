/** Compare normalized native SDK fixture results. @license Apache-2.0 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function load(path) {
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (!value || !Array.isArray(value.cases) || typeof value.language !== 'string') {
    throw new TypeError(`${path}: invalid conformance result`);
  }
  return value;
}

function compareValue(expected, actual, path, errors) {
  if (Object.is(expected, actual)) return;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) { errors.push(`${path} expected array, received ${JSON.stringify(actual)}`); return; }
    if (expected.length !== actual.length) errors.push(`${path}.length expected ${expected.length}, received ${actual.length}`);
    for (let i = 0; i < expected.length; i += 1) {
      if (i >= actual.length) errors.push(`${path}[${i}] is missing`);
      else compareValue(expected[i], actual[i], `${path}[${i}]`, errors);
    }
    return;
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) { errors.push(`${path} expected object, received ${JSON.stringify(actual)}`); return; }
    for (const key of Object.keys(expected).sort()) {
      if (!(key in actual)) errors.push(`${path}.${key} is missing`);
      else compareValue(expected[key], actual[key], `${path}.${key}`, errors);
    }
    for (const key of Object.keys(actual).sort()) if (!(key in expected)) errors.push(`${path}.${key} is unexpected`);
    return;
  }
  errors.push(`${path} expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
}

export function compareResults(results, options = {}) {
  if (!Array.isArray(results) || results.length === 0) throw new TypeError('at least one result is required');
  let known;
  if (options.manifest) known = new Set(JSON.parse(readFileSync(options.manifest, 'utf8')).map((entry) => entry.file));
  const languages=new Set();
  for (const result of results) {
    if(languages.has(result.language))throw new TypeError(`duplicate language ${result.language}`);languages.add(result.language);
    const seen = new Set();
    for (const row of result.cases) {
      if (typeof row.fixture !== 'string') throw new TypeError(`${result.language}: fixture must be a string`);
      if (seen.has(row.fixture)) throw new TypeError(`${result.language}: duplicate fixture ${row.fixture}`);
      if (known && !known.has(row.fixture)) throw new TypeError(`${result.language}: unknown fixture ${row.fixture}`);
      seen.add(row.fixture);
    }
    if(known)for(const fixture of known)if(!seen.has(fixture))throw new TypeError(`${result.language}: missing fixture ${fixture}`);
  }
  const baseline = new Map(results[0].cases.map((row) => [row.fixture, row]));
  const errors = [];
  for (const result of results.slice(1)) {
    if(result.protocolVersion!==results[0].protocolVersion)errors.push(`${result.language}: protocolVersion expected ${results[0].protocolVersion}, received ${result.protocolVersion}`);
    const rows = new Map(result.cases.map((row) => [row.fixture, row]));
    for (const [fixture, expected] of baseline) {
      const actual = rows.get(fixture);
      if (!actual) { errors.push(`${result.language}: ${fixture} is missing`); continue; }
      for (const field of ['decoded', 'roundTrip', 'errorCode']) compareValue(expected[field], actual[field], `${result.language}: ${fixture}.${field}`, errors);
    }
    for (const fixture of rows.keys()) if (!baseline.has(fixture)) errors.push(`${result.language}: ${fixture} is unexpected`);
  }
  return errors;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const manifest = resolve('conformance/v1/manifest.json');
  const results = process.argv.slice(2).map(load);
  const errors = compareResults(results, { manifest });
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log(`Conformance equivalent: ${results.map((r) => r.language).join(', ')}`);
}
