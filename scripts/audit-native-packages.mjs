/** Reject native package boundary violations before distribution. @license Apache-2.0 */
import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
const bannedExtensions = new Set([
  '.a',
  '.bin',
  '.dll',
  '.dylib',
  '.env',
  '.gguf',
  '.onnx',
  '.pt',
  '.pth',
  '.so',
  '.tflite',
  '.wasm',
]);
const ignored = new Set([
  '.dart_tool',
  '.next',
  '.pytest_cache',
  '__pycache__',
  'build',
  'dist',
]);

function isEnvironmentFile(name) {
  return name.split('/').some((part) => part === '.env' || part.startsWith('.env.'));
}

function readVarint(data, start) {
  let value = 0;
  let shift = 0;
  for (let index = start; index < data.length && index < start + 10; index++) {
    const byte = data[index];
    value += (byte & 0x7f) * (2 ** shift);
    if ((byte & 0x80) === 0) return [value, index + 1];
    shift += 7;
  }
  return null;
}

function looksLikeOnnx(data) {
  let index = 0;
  let hasIrVersion = false;
  let hasGraph = false;
  while (index < data.length) {
    const key = readVarint(data, index);
    if (!key || key[0] === 0) return false;
    index = key[1];
    const field = Math.floor(key[0] / 8);
    const wireType = key[0] & 7;
    if (wireType === 0) {
      const value = readVarint(data, index);
      if (!value) return false;
      if (field === 1 && value[0] > 0) hasIrVersion = true;
      index = value[1];
    } else if (wireType === 1) index += 8;
    else if (wireType === 2) {
      const length = readVarint(data, index);
      if (!length) return false;
      if (field === 7 && length[0] > 0) hasGraph = true;
      index = length[1] + length[0];
    } else if (wireType === 5) index += 4;
    else return false;
    if (index > data.length) return false;
  }
  return hasIrVersion && hasGraph;
}

function hasModelPayload(data, text) {
  if (
    data.subarray(0, 4).equals(Buffer.from('GGUF')) ||
    data.subarray(0, 4).equals(Buffer.from('TFL3')) ||
    data.subarray(4, 8).equals(Buffer.from('TFL3')) ||
    looksLikeOnnx(data)
  ) return true;
  const candidates = /(?:data:application\/(?:onnx|x-onnx|octet-stream);base64,|\b)((?:T05OWA|R0dVRg|VEZMMw|Z2dtbA)[A-Za-z0-9+/_=-]*|[A-Za-z0-9+/_-]{8,}={0,2})/giu;
  for (const match of text.matchAll(candidates)) {
    try {
      const decoded = Buffer.from(match[1].replaceAll('-', '+').replaceAll('_', '/'), 'base64');
      if (
        decoded.subarray(0, 4).equals(Buffer.from('GGUF')) ||
        decoded.subarray(0, 4).equals(Buffer.from('TFL3')) ||
        decoded.subarray(4, 8).equals(Buffer.from('TFL3')) ||
        looksLikeOnnx(decoded)
      ) return true;
    } catch {
      // Ignore malformed candidates.
    }
  }
  return false;
}

function contentFindings(data) {
  const findings = [];
  const text = data.toString('utf8');
  const credential = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b|\b(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*["']?([A-Za-z0-9_./+=-]{16,})/iu;
  if (credential.test(text)) findings.push('possible credential material');
  if (hasModelPayload(data, text)) findings.push('embedded model content');
  const corpusObject = /["']corpusId["']\s*:\s*["'][^"']+["']/u.test(text) &&
    /["']symbols["']\s*:\s*\[/u.test(text) &&
    /["']words["']\s*:\s*\[/u.test(text);
  if (corpusObject) findings.push('embedded corpus data');
  try {
    const value = JSON.parse(text);
    if (
      value &&
      typeof value === 'object' &&
      typeof value.corpusId === 'string' &&
      Array.isArray(value.symbols) &&
      Array.isArray(value.words)
    ) {
      if (!corpusObject) findings.push('embedded corpus data');
    }
  } catch {
    // Most source files are not standalone JSON documents.
  }
  return findings;
}

async function walk(path, output) {
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) await walk(child, output);
    else output.push(child);
  }
}

function inspectCommand(command, args, cwd, label) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GOCACHE: join(tmpdir(), 'qaraa-native-audit-go-cache') },
  });
  if (result.error?.code === 'ENOENT') return { skipped: `${label}: ${command} unavailable` };
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout).trim().split('\n').at(-1);
    return { error: `${label}: ${detail || `${command} exited ${result.status}`}` };
  }
  return {};
}

async function inspectPythonArchives(root, errors, warnings) {
  const directory = join(root, 'sdk', 'python', 'dist');
  let archives;
  try {
    archives = (await readdir(directory)).filter((name) =>
      name.endsWith('.whl') || name.endsWith('.tar.gz'),
    );
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  const inspector = [
    'import base64, json, pathlib, re, sys, tarfile, zipfile',
    "banned = {'.a','.bin','.dll','.dylib','.env','.gguf','.onnx','.pt','.pth','.so','.tflite','.wasm'}",
    "credential = re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\\bAKIA[0-9A-Z]{16}\\b|\\bgh[pousr]_[A-Za-z0-9]{36,}\\b|\\bgithub_pat_[A-Za-z0-9_]{22,}\\b|\\b(?:api[_-]?key|access[_-]?token|secret|password)\\s*[:=]\\s*[\\\"\\\']?([A-Za-z0-9_./+=-]{16,})', re.I)",
    "encoded_model = re.compile(rb'(?:data:application/(?:onnx|x-onnx|octet-stream);base64,|\\b)((?:T05OWA|R0dVRg|VEZMMw|Z2dtbA)[A-Za-z0-9+/_=-]*|[A-Za-z0-9+/_-]{8,}={0,2})', re.I)",
    "corpus_id = re.compile(rb'[\\\"\\\']corpusId[\\\"\\\']\\s*:\\s*[\\\"\\\'][^\\\"\\\']+[\\\"\\\']')",
    "corpus_symbols = re.compile(rb'[\\\"\\\']symbols[\\\"\\\']\\s*:\\s*\\[')",
    "corpus_words = re.compile(rb'[\\\"\\\']words[\\\"\\\']\\s*:\\s*\\[')",
    'def read_varint(data, start):',
    ' value = shift = 0',
    ' for index in range(start, min(len(data), start + 10)):',
    '  byte = data[index]; value += (byte & 127) << shift',
    '  if byte & 128 == 0: return value, index + 1',
    '  shift += 7',
    ' return None',
    'def onnx(data):',
    ' index = 0; ir = graph = False',
    ' while index < len(data):',
    '  key = read_varint(data, index)',
    '  if not key or key[0] == 0: return False',
    '  value, index = key; field, wire = value >> 3, value & 7',
    '  if wire == 0:',
    '   item = read_varint(data, index)',
    '   if not item: return False',
    '   if field == 1 and item[0] > 0: ir = True',
    '   index = item[1]',
    '  elif wire == 1: index += 8',
    '  elif wire == 2:',
    '   item = read_varint(data, index)',
    '   if not item: return False',
    '   if field == 7 and item[0] > 0: graph = True',
    '   index = item[1] + item[0]',
    '  elif wire == 5: index += 4',
    '  else: return False',
    '  if index > len(data): return False',
    ' return ir and graph',
    'def model(data):',
    " if data[:4] in {b'GGUF', b'TFL3'} or data[4:8] == b'TFL3' or onnx(data): return True",
    ' for match in encoded_model.finditer(data):',
    '  try: decoded = base64.b64decode(match.group(1).replace(b"-", b"+").replace(b"_", b"/"), validate=False)',
    '  except (ValueError, TypeError): continue',
    "  if decoded[:4] in {b'GGUF', b'TFL3'} or decoded[4:8] == b'TFL3' or onnx(decoded): return True",
    ' return False',
    'for raw in sys.argv[1:]:',
    ' p = pathlib.Path(raw)',
    " archive = zipfile.ZipFile(p) if p.suffix == '.whl' else tarfile.open(p)",
    " names = archive.namelist() if p.suffix == '.whl' else archive.getnames()",
    ' for name in names:',
    "  parts = pathlib.PurePosixPath(name).parts",
    "  forbidden = pathlib.PurePosixPath(name).suffix in banned or any(part == '.env' or part.startswith('.env.') for part in parts)",
    "  application = any(part in {'examples','packages','conformance','scripts'} for part in parts)",
    "  if forbidden: print(f'{p.name}:{name}:forbidden artifact')",
    "  if application: print(f'{p.name}:{name}:application code in distribution')",
    "  try: data = archive.read(name) if p.suffix == '.whl' else (archive.extractfile(name).read() if archive.extractfile(name) else b'')",
    "  except (KeyError, OSError): data = b''",
    "  if credential.search(data): print(f'{p.name}:{name}:possible credential material')",
    "  if model(data): print(f'{p.name}:{name}:embedded model content')",
    "  corpus_object = corpus_id.search(data) and corpus_symbols.search(data) and corpus_words.search(data)",
    "  if corpus_object: print(f'{p.name}:{name}:embedded corpus data')",
    "  try:",
    "   value = json.loads(data)",
    "   if not corpus_object and isinstance(value, dict) and isinstance(value.get('corpusId'), str) and isinstance(value.get('symbols'), list) and isinstance(value.get('words'), list): print(f'{p.name}:{name}:embedded corpus data')",
    "  except (UnicodeDecodeError, json.JSONDecodeError): pass",
    " archive.close()",
  ].join('\n');
  const result = spawnSync('python3', ['-c', inspector, ...archives.map((name) => join(directory, name))], {
    encoding: 'utf8',
  });
  if (result.error?.code === 'ENOENT') {
    warnings.push('Python archive inspection skipped: python3 unavailable');
  } else if (result.status !== 0) {
    errors.push(`sdk/python/dist: archive inspection failed: ${(result.stderr || '').trim()}`);
  } else {
    for (const line of result.stdout.trim().split('\n').filter(Boolean)) {
      const split = line.lastIndexOf(':');
      errors.push(`sdk/python/dist/${line.slice(0, split)}: ${line.slice(split + 1)}`);
    }
  }
}

export async function auditNativeTree(
  root,
  { inspectTools = true, release = false } = {},
) {
  const files = [];
  await walk(join(root, 'sdk'), files);
  await walk(join(root, 'examples'), files);
  files.sort();

  const errors = [];
  const warnings = [];
  for (const file of files) {
    const name = relative(root, file).replaceAll('\\', '/');
    if (bannedExtensions.has(extname(file)) || isEnvironmentFile(name)) {
      errors.push(`${name}: forbidden artifact`);
    }
    const data = await readFile(file).catch(() => null);
    const text = data?.toString('utf8');
    if (text && /\/Users\/|[A-Za-z]:\\Users\\/u.test(text)) {
      errors.push(`${name}: local absolute path`);
    }
    if (data) {
      for (const finding of contentFindings(data)) errors.push(`${name}: ${finding}`);
    }
  }

  if (release) {
    const go = await readFile(join(root, 'sdk', 'go', 'go.mod'), 'utf8');
    if (go.includes('qaraa.local/sdk/go')) {
      errors.push('sdk/go/go.mod: local module path blocks release');
    }
  }

  await inspectPythonArchives(root, errors, warnings);
  if (inspectTools) {
    for (const [directory, label] of [
      ['sdk/go', 'Go SDK module inspection'],
      ['examples/go-server', 'Go example module inspection'],
    ]) {
      const result = inspectCommand('go', ['list', '-f', '{{.Dir}} {{join .GoFiles " "}}', './...'], join(root, directory), label);
      if (result.error) errors.push(result.error);
      if (result.skipped) warnings.push(result.skipped);
    }

    const dartCheck = spawnSync('dart', ['--version'], { encoding: 'utf8' });
    if (dartCheck.error?.code === 'ENOENT') {
      warnings.push('Dart publish dry-run skipped: dart unavailable');
    } else {
      const result = inspectCommand('dart', ['pub', 'publish', '--dry-run'], join(root, 'sdk', 'dart'), 'Dart publish dry-run');
      if (result.error) errors.push(result.error);
    }
  }

  return {
    errors: errors.sort(),
    files: files.length,
    warnings: warnings.sort(),
  };
}

async function main() {
  const result = await auditNativeTree(sourceRoot, {
    inspectTools: !process.argv.includes('--source-only'),
    release: process.argv.includes('--release'),
  });
  for (const warning of result.warnings) console.warn(warning);
  if (result.errors.length) {
    console.error(result.errors.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`Native package audit passed (${result.files} source files)`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
