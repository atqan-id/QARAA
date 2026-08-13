import { execFile } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { realpathSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const execFileAsync = promisify(execFile);
const allowedRootFiles = new Set(['README.md', 'LICENSE', 'package.json']);
const modelArtifact = /(?:^|[/\\])(?:models?|weights?|checkpoints?)(?:[/\\.]|$)|\.(?:bin|ckpt|engine|ggml|gguf|h5|model|onnx|pb|pt|safetensors|tflite)$/i;
const secretFile = /(?:^|[/\\])\.env[^/\\]*$|(?:^|[/\\])[^/\\]*(?:token|secret|credential|password|apikey|api-key)[^/\\]*(?:\.[^/\\]+)?$/i;
const applicationFile = /(?:^|[/\\])(?:app|application|apps|assets?|client|pages|routes|server|src)(?:[/\\.]|$)|\.(?:html|jsx|svelte|tsx|vue)$/i;
const datasetFile = /(?:^|[/\\])(?:ayahs?|corpus|data|datasets?|fixtures?|mushaf|quran|surahs?|uthmani|verses?)(?:[/\\.]|$)|\.(?:arrow|csv|db|jsonl|parquet|sqlite|tsv)$/i;
const protocolSchemaFile = /(?:^|\/)schemas\/v1\/(?:command|corpus|error|event|observation|snapshot)\.schema\.json$/u;
const windowsAbsolutePath = /^(?:[A-Za-z]:[/\\]|\\\\[^\\])/u;
const sourceMapApplicationArtifact = /(?:^|[/\\])(?:app|application|apps|assets?|pages|routes)(?:[/\\.]|$)|\.(?:html|jsx|svelte|tsx|vue)$/i;
const sourceMapDatasetArtifact = /(?:^|[/\\])(?:data|datasets?|fixtures?)(?:[/\\]|$)|(?:^|[/\\])(?:ayahs?|corpus|mushaf|quran|surahs?|uthmani|verses?)\.(?:arrow|csv|db|json|jsonl|parquet|sqlite|tsv)$/i;
const encodedModelAssignment = /(?:["']?(?:[$A-Z_a-z][$\w]*)?(?:weights?|checkpoint)[$\w]*["']?\s*(?:=|:)\s*["'`](?:data:[^,]{1,80};base64,)?[A-Za-z0-9+/_-]{64,}={0,2}["'`]|["']?(?:[$A-Z_a-z][$\w]*)?model[$\w]*["']?\s*(?:=|:)\s*["'`](?:data:application\/(?:octet-stream|onnx|x-onnx);base64,[A-Za-z0-9+/_-]{64,}={0,2}|(?:R0dVRg|T05OWA|VEZMMw|Z2dtbA)[A-Za-z0-9+/_-]{58,}={0,2})["'`])/iu;
const numericModelAssignment = /["']?(?:[$A-Z_a-z][$\w]*)?(?:model|weights?|checkpoint)[$\w]*["']?\s*(?:=|:)\s*(?:(?:new\s+)?(?:Float32Array|Uint8Array)\s*\(|(?:Float32Array|Uint8Array)\.from\s*\()?\s*\[(?:\s*-?\d+(?:\.\d+)?\s*,){15,}/iu;
const encodedBytes = /^[A-Za-z0-9+/_-]{64,}={0,2}$/u;
const encodedModelDataUri = /^data:application\/(onnx|x-onnx|octet-stream);base64,([A-Za-z0-9+/_-]{64,}={0,2})$/iu;
const embeddedQuranRecord = /[\u0600-\u06ff]{2,}/u;
const quranDatasetAssignment = /(?:["']?(?:quran|mushaf)[$\w]*["']?|["']?(?:ayah|verse)(?:s|Data|Dataset|Records?)[$\w]*["']?|["']?corpus(?:Data|Dataset|Records?)[$\w]*["']?)\s*(?:=|:)\s*[\[{]/iu;
const embeddedCorpusLiteral = /["']?corpusId["']?\s*:[\s\S]{0,4096}["']?symbols["']?\s*:\s*\[[\s\S]{0,4096}["']?words["']?\s*:\s*\[/iu;
const htmlApplicationPayload = /<!doctype\s+html\b|<html(?:\s|>)[\s\S]{0,4096}<body(?:\s|>)/iu;
const applicationBootstrap = /\b(?:ReactDOM\.)?createRoot\s*\(\s*document\.|\bcreateApp\s*\([^)]*\)\.mount\s*\(|\bdocument\.getElementById\s*\([^)]*\)[\s\S]{0,256}\b(?:hydrateRoot|mount|render)\b/u;
const secretMaterial = [
  /-----BEGIN (?:DSA |EC |OPENSSH |PGP |RSA )?PRIVATE KEY-----/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bghp_[A-Za-z0-9]{32,}\b/u,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/u,
  /\bAIza[0-9A-Za-z_-]{35}\b/u,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/u,
  /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/u,
  /\bsk-(?:live|proj)-[A-Za-z0-9_-]{16,}\b/u,
];
const privateEndpoint = [
  /https?:\/\/(?:[A-Za-z0-9-]+\.)*(?:corp|internal|lan|local)(?::\d+)?(?:[/?#\s]|$)/iu,
  /https?:\/\/10(?:\.\d{1,3}){3}(?::\d+)?(?:[/?#\s]|$)/u,
  /https?:\/\/172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}(?::\d+)?(?:[/?#\s]|$)/u,
  /https?:\/\/192\.168(?:\.\d{1,3}){2}(?::\d+)?(?:[/?#\s]|$)/u,
];
const builtins = new Set(builtinModules.flatMap((name) => [name, name.replace(/^node:/u, '')]));
const auditedRuntimeDependencies = new Map([
  ['@atqan/qaraa-protocol', new Map([
    ['@atqan/qaraa-core', 'workspace:*'],
    ['ajv', '8.20.0'],
  ])],
  ['@atqan/qaraa-server', new Map([
    ['@atqan/qaraa-core', 'workspace:*'],
    ['@atqan/qaraa-protocol', 'workspace:*'],
    ['@fastify/websocket', '11.3.0'],
    ['fastify', '5.11.3'],
  ])],
  ['@atqan/qaraa-client', new Map([
    ['@atqan/qaraa-core', 'workspace:*'],
    ['@atqan/qaraa-protocol', 'workspace:*'],
  ])],
  ['@atqan/qaraa-sherpa-onnx', new Map([
    ['@atqan/qaraa-core', 'workspace:*'],
  ])],
  ...['react', 'preact', 'vue', 'angular', 'svelte', 'solid', 'lit'].map((adapter) => [
    `@atqan/qaraa-${adapter}`,
    new Map([
      ['@atqan/qaraa-client', 'workspace:*'],
      ['@atqan/qaraa-core', 'workspace:*'],
    ]),
  ]),
]);
auditedRuntimeDependencies.get('@atqan/qaraa-angular')?.set('tslib', '^2.8.1');

function normalizedName(fileName) {
  return fileName.replaceAll('\\', '/').replace(/^package\//, '');
}

function isEncodedModelPayload(value) {
  const dataUri = encodedModelDataUri.exec(value);
  if (dataUri && dataUri[1]?.toLowerCase() !== 'octet-stream') return true;
  const encoded = dataUri?.[2] ?? value;
  if (!encodedBytes.test(encoded)) return false;
  try {
    const header = Buffer.from(encoded.slice(0, 96), 'base64');
    return hasTypedModelMagic(header);
  } catch {
    return false;
  }
}

function numericLiteralValue(node) {
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand)) {
    const value = Number(node.operand.text);
    if (node.operator === ts.SyntaxKind.MinusToken) return -value;
    if (node.operator === ts.SyntaxKind.PlusToken) return value;
  }
  return undefined;
}

function uint8ArrayLiteral(node) {
  let expression;
  let argument;
  if (ts.isNewExpression(node) || ts.isCallExpression(node)) {
    expression = node.expression;
    [argument] = node.arguments ?? [];
  }
  const isUint8Constructor = expression && ts.isIdentifier(expression)
    && expression.text === 'Uint8Array';
  const isUint8From = expression && ts.isPropertyAccessExpression(expression)
    && ts.isIdentifier(expression.expression)
    && expression.expression.text === 'Uint8Array'
    && expression.name.text === 'from';
  if ((!isUint8Constructor && !isUint8From) || !argument || !ts.isArrayLiteralExpression(argument)) {
    return undefined;
  }
  const values = argument.elements.map(numericLiteralValue);
  return values.every((value) => value !== undefined) ? values : undefined;
}

function startsWithBytes(values, expected, offset = 0) {
  return expected.every((value, index) => values[index + offset] === value);
}

function hasTypedModelMagic(values) {
  return startsWithBytes(values, [71, 71, 85, 70])
    || startsWithBytes(values, [103, 103, 109, 108])
    || startsWithBytes(values, [137, 72, 68, 70, 13, 10, 26, 10])
    || startsWithBytes(values, [79, 78, 78, 88])
    || startsWithBytes(values, [84, 70, 76, 51])
    || startsWithBytes(values, [84, 70, 76, 51], 4);
}

function hasIdentifierIndependentModelPayload(sourceName, sourceContent) {
  if (sourceName.endsWith('.json')) {
    try {
      const pending = [JSON.parse(sourceContent)];
      while (pending.length > 0) {
        const value = pending.pop();
        if (typeof value === 'string' && isEncodedModelPayload(value)) return true;
        if (Array.isArray(value)) pending.push(...value);
        else if (value && typeof value === 'object') pending.push(...Object.values(value));
      }
    } catch {
      return false;
    }
    return false;
  }

  const sourceFile = ts.createSourceFile(sourceName, sourceContent, ts.ScriptTarget.Latest, true);
  let found = false;
  function visit(node) {
    if (found) return;
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      && isEncodedModelPayload(node.text)) {
      found = true;
      return;
    }
    const bytes = uint8ArrayLiteral(node);
    if (bytes && hasTypedModelMagic(bytes)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

export function inspectPackList(packageDir, fileNames) {
  const violations = [];

  for (const originalName of fileNames) {
    const fileName = normalizedName(originalName);
    let reason;
    if (secretFile.test(fileName)) reason = 'secret-like file';
    else if (modelArtifact.test(fileName)) reason = 'model artifact';
    else if (datasetFile.test(fileName) && !protocolSchemaFile.test(fileName)) reason = 'dataset artifact';
    else if (applicationFile.test(fileName)) reason = 'application file';
    else if (!fileName.startsWith('dist/') && !allowedRootFiles.has(fileName)) reason = 'outside the published allowlist';

    if (reason) {
      violations.push({
        fileName,
        message: `${packageDir}: ${reason} must not be published (${fileName})`,
        reason,
      });
    }
  }

  return violations;
}

function absoluteSourceMapPath(value) {
  return typeof value === 'string'
    && (isAbsolute(value) || windowsAbsolutePath.test(value) || value.startsWith('file:'));
}

export function inspectSourceMap(fileName, content, repositoryRoot) {
  let sourceMap;
  try {
    sourceMap = JSON.parse(content);
  } catch {
    return [{ fileName, reason: 'malformed source map' }];
  }

  const violations = [];
  if (absoluteSourceMapPath(sourceMap.file)) {
    violations.push({ fileName, reason: 'absolute source-map file' });
  }
  if (absoluteSourceMapPath(sourceMap.sourceRoot)) {
    violations.push({ fileName, reason: 'absolute source-map sourceRoot' });
  }
  for (const source of Array.isArray(sourceMap.sources) ? sourceMap.sources : []) {
    if (absoluteSourceMapPath(source)) {
      violations.push({ fileName, reason: 'absolute source-map source' });
    }
  }
  if (repositoryRoot && content.includes(repositoryRoot)) {
    violations.push({ fileName, reason: 'repository path disclosure' });
  }
  return violations;
}

export function inspectPackedContent(fileName, content) {
  const secrets = secretMaterial
    .filter((pattern) => pattern.test(content))
    .map(() => ({ fileName, reason: 'secret material' }));
  const endpoints = privateEndpoint
    .filter((pattern) => pattern.test(content))
    .map(() => ({ fileName, reason: 'private endpoint' }));
  const materials = new Set();

  function inspectMaterial(sourceName, sourceContent) {
    const isProtocolSchema = protocolSchemaFile.test(normalizedName(sourceName));
    if (encodedModelAssignment.test(sourceContent)
      || numericModelAssignment.test(sourceContent)
      || hasIdentifierIndependentModelPayload(sourceName, sourceContent)) {
      materials.add('model material');
    }
    const hasQuranCoordinates = /["']?surah["']?\s*:/iu.test(sourceContent)
      && /["']?ayah["']?\s*:/iu.test(sourceContent)
      && /["']?text["']?\s*:/iu.test(sourceContent);
    if (!isProtocolSchema && (quranDatasetAssignment.test(sourceContent)
      || embeddedCorpusLiteral.test(sourceContent)
      || (embeddedQuranRecord.test(sourceContent) && hasQuranCoordinates))) {
      materials.add('dataset material');
    }
    if (htmlApplicationPayload.test(sourceContent) || applicationBootstrap.test(sourceContent)) {
      materials.add('application material');
    }
  }

  if (fileName.endsWith('.map')) {
    try {
      const sourceMap = JSON.parse(content);
      const sources = Array.isArray(sourceMap.sources) ? sourceMap.sources : [];
      const sourcesContent = Array.isArray(sourceMap.sourcesContent) ? sourceMap.sourcesContent : [];
      for (const [index, source] of sources.entries()) {
        if (typeof source !== 'string') continue;
        const normalizedSource = normalizedName(source);
        if (modelArtifact.test(normalizedSource)) materials.add('model material');
        if (sourceMapDatasetArtifact.test(normalizedSource)
          && !protocolSchemaFile.test(normalizedSource)) {
          materials.add('dataset material');
        }
        if (sourceMapApplicationArtifact.test(normalizedSource)) {
          materials.add('application material');
        }
        if (typeof sourcesContent[index] === 'string') {
          inspectMaterial(normalizedSource, sourcesContent[index]);
        }
      }
    } catch {
      // Source-map syntax is reported by inspectSourceMap.
    }
  } else {
    inspectMaterial(fileName, content);
  }

  const artifactViolations = ['model material', 'dataset material', 'application material']
    .filter((reason) => materials.has(reason))
    .map((reason) => ({ fileName, reason }));
  return [...secrets, ...endpoints, ...artifactViolations];
}

function packageName(specifier) {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/');
  return specifier.split('/')[0];
}

function runtimeSpecifiers(sourceText, fileName) {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true);
  const specifiers = [];

  function add(node) {
    if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) {
      specifiers.push(node.text);
    }
  }

  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      add(node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node.moduleReference.expression);
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) add(node.arguments[0]);
      if (ts.isIdentifier(node.expression) && node.expression.text === 'require') add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

export function inspectRuntimeImports(packageDir, manifest, sourceText, fileName) {
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);
  const imports = new Set(runtimeSpecifiers(sourceText, fileName));
  const violations = [];

  for (const specifier of imports) {
    if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('file:')) continue;
    const dependency = packageName(specifier.replace(/^node:/u, ''));
    if (specifier.startsWith('node:') || builtins.has(dependency) || dependency === manifest.name) continue;
    if (!declared.has(dependency)) {
      violations.push(`${packageDir}: undeclared runtime dependency ${dependency} in ${fileName}`);
    }
  }
  return violations.sort();
}

export function validateManifest(packageDir, manifest) {
  const violations = [];
  if (!manifest.exports || typeof manifest.exports !== 'object') {
    violations.push(`${packageDir}: package must declare explicit exports`);
  }
  if (typeof manifest.sideEffects !== 'boolean') {
    violations.push(`${packageDir}: package must declare sideEffects metadata`);
  }
  const allowedDependencies = auditedRuntimeDependencies.get(manifest.name) ?? new Map();
  for (const [dependency, version] of Object.entries(manifest.dependencies ?? {})) {
    if (allowedDependencies.get(dependency) !== version) {
      violations.push(`${packageDir}: runtime dependency ${dependency}@${version} requires an explicit audit`);
    }
  }
  return violations;
}

async function packedFileNames(packageDir) {
  const { stdout } = await execFileAsync('pnpm', ['--dir', packageDir, 'pack', '--dry-run', '--json']);
  const result = JSON.parse(stdout);
  const pack = Array.isArray(result) ? result[0] : result;
  if (!pack || !Array.isArray(pack.files)) {
    throw new Error(`${packageDir}: pnpm pack did not return a file list`);
  }
  return pack.files.map((file) => (typeof file === 'string' ? file : file.path));
}

async function auditPackage(packageDir) {
  const repositoryRoot = resolve(packageDir, '..', '..');
  const manifest = JSON.parse(await readFile(resolve(packageDir, 'package.json'), 'utf8'));
  const violations = validateManifest(packageDir, manifest);
  const fileNames = await packedFileNames(packageDir);
  violations.push(...inspectPackList(packageDir, fileNames).map(({ message }) => message));
  for (const fileName of fileNames) {
    const normalized = normalizedName(fileName);
    const sourcePath = normalized === 'LICENSE'
      ? resolve(repositoryRoot, 'LICENSE')
      : resolve(packageDir, normalized);
    const content = await readFile(sourcePath, 'utf8');
    violations.push(...inspectPackedContent(normalized, content).map(({ reason }) => (
      `${packageDir}: ${reason} in ${normalized}`
    )));
    if (!normalized.startsWith('dist/')) continue;
    if (normalized.endsWith('.map')) {
      violations.push(...inspectSourceMap(normalized, content, repositoryRoot).map(({ reason }) => (
        `${packageDir}: ${reason} in ${normalized}`
      )));
    }
    if (normalized.endsWith('.mjs') || normalized.endsWith('.cjs')) {
      violations.push(...inspectRuntimeImports(packageDir, manifest, content, normalized));
    }
  }
  return violations;
}

async function main() {
  const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const packagesDirectory = resolve(rootDirectory, 'packages');
  const packageEntries = await readdir(packagesDirectory, { withFileTypes: true });
  const packageDirectories = [];
  for (const entry of packageEntries) {
    if (!entry.isDirectory()) continue;
    const packageDirectory = resolve(packagesDirectory, entry.name);
    const manifest = JSON.parse(await readFile(resolve(packageDirectory, 'package.json'), 'utf8'));
    if (manifest.private !== true) packageDirectories.push(packageDirectory);
  }
  const results = await Promise.all(packageDirectories.map(auditPackage));
  const violations = results.flat();

  if (violations.length === 0) return;
  for (const violation of violations) console.error(violation.replace(rootDirectory, '.'));
  process.exitCode = 1;
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  await main();
}
