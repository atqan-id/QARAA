import { realpathSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageImports = [
  ['@atqan/qaraa-client', 'QARAA client import'],
  ['@atqan/qaraa-server', 'QARAA server import'],
  ['@atqan/qaraa-protocol', 'QARAA protocol import'],
  ['@atqan/qaraa-sherpa-onnx', 'Sherpa-ONNX import'],
];

const frameworkImports = new Set([
  '@angular/core',
  '@angular/common',
  'next',
  'nuxt',
  'react',
  'react-dom',
  'svelte',
  'vue',
]);

const networkImports = new Set([
  '@microsoft/signalr',
  'axios',
  'got',
  'graphql-request',
  'socket.io-client',
  'undici',
  'ws',
]);

const nodeBuiltins = new Set([
  'assert', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto',
  'dgram', 'diagnostics_channel', 'dns', 'domain', 'events', 'fs', 'http', 'http2',
  'https', 'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring',
  'readline', 'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls', 'trace_events',
  'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
]);

const browserGlobals = new Set([
  'Audio', 'AudioBuffer', 'AudioBufferSourceNode', 'AudioContext', 'AudioData', 'AudioDecoder',
  'AudioEncoder', 'AudioListener', 'AudioNode', 'AudioParam', 'AudioScheduledSourceNode',
  'AudioWorklet', 'AudioWorkletNode', 'BaseAudioContext', 'Blob', 'BroadcastChannel',
  'Document', 'Element', 'EventSource', 'File', 'FormData', 'HTMLAnchorElement',
  'HTMLAudioElement', 'HTMLCanvasElement', 'HTMLDivElement', 'HTMLElement', 'HTMLIFrameElement',
  'HTMLImageElement', 'HTMLInputElement', 'HTMLMediaElement', 'HTMLVideoElement', 'Headers',
  'Image', 'MessageChannel', 'Navigator', 'Node', 'NodeList', 'OfflineAudioContext', 'Request',
  'Response', 'SVGElement', 'ShadowRoot', 'WebSocket', 'Worker', 'XMLHttpRequest', 'caches',
  'document', 'fetch', 'indexedDB', 'location', 'localStorage', 'navigator', 'screen',
  'sessionStorage', 'window',
]);

const globalObjectNames = new Set(['globalThis', 'self', 'window']);

function importSpecifiers(sourceFile, checker) {
  const specifiers = [];

  function addSpecifier(moduleSpecifier) {
    const specifier = staticStringValue(moduleSpecifier);
    if (specifier) specifiers.push(specifier);
  }

  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addSpecifier(node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      addSpecifier(node.moduleReference.expression);
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        addSpecifier(node.arguments[0]);
      } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require' && isUnshadowedIdentifier(node.expression, checker)) {
        addSpecifier(node.arguments[0]);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

function addViolation(violations, filePath, rule, symbol) {
  violations.push({
    filePath,
    message: `${filePath}: ${rule} is not allowed in @atqan/qaraa-core (${symbol})`,
    rule,
    symbol,
  });
}

export function findBoundaryViolations(sourceText, filePath) {
  const violations = [];
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
  const compilerOptions = { noLib: true, noResolve: true };
  const compilerHost = ts.createCompilerHost(compilerOptions);
  const absoluteFilePath = resolve(filePath);
  compilerHost.fileExists = (candidate) => resolve(candidate) === absoluteFilePath;
  compilerHost.getSourceFile = (candidate) => (
    resolve(candidate) === absoluteFilePath ? sourceFile : undefined
  );
  compilerHost.readFile = (candidate) => (
    resolve(candidate) === absoluteFilePath ? sourceText : undefined
  );
  const checker = ts.createProgram([filePath], compilerOptions, compilerHost).getTypeChecker();

  for (const specifier of importSpecifiers(sourceFile, checker)) {
    const qaraaImport = packageImports.find(([name]) => specifier === name || specifier.startsWith(`${name}/`));
    if (qaraaImport) {
      addViolation(violations, filePath, qaraaImport[1], specifier);
    } else if (frameworkImports.has(specifier) || [...frameworkImports].some((name) => specifier.startsWith(`${name}/`))) {
      addViolation(violations, filePath, 'framework import', specifier);
    } else if (networkImports.has(specifier) || [...networkImports].some((name) => specifier.startsWith(`${name}/`))) {
      addViolation(violations, filePath, 'network import', specifier);
    } else if (specifier.startsWith('node:') || [...nodeBuiltins].some((name) => specifier === name || specifier.startsWith(`${name}/`))) {
      addViolation(violations, filePath, 'Node built-in import', specifier);
    }
  }

  function visit(node) {
    const globalObjectMember = globalObjectBrowserMember(node, checker);
    if (globalObjectMember) {
      addViolation(violations, filePath, 'browser API', globalObjectMember);
    }
    if (ts.isVariableDeclaration(node)) {
      for (const member of globalObjectDestructuredBrowserMembers(node, checker)) {
        addViolation(violations, filePath, 'browser API', member);
      }
    }
    if (ts.isIdentifier(node) && browserGlobals.has(node.text) && isBrowserReference(node, checker)) {
      addViolation(violations, filePath, 'browser API', node.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  return violations;
}

function staticStringValue(node) {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
}

function globalObjectBrowserMember(node, checker) {
  if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return undefined;
  if (!isGlobalObjectReference(node.expression, checker)) return undefined;
  const member = ts.isPropertyAccessExpression(node) ? node.name.text : staticStringValue(node.argumentExpression);
  return member && browserGlobals.has(member) ? member : undefined;
}

function globalObjectDestructuredBrowserMembers(node, checker) {
  if (!node.initializer || !isGlobalObjectReference(node.initializer, checker) || !ts.isObjectBindingPattern(node.name)) {
    return [];
  }
  return node.name.elements.flatMap((element) => {
    const member = staticStringValue(element.propertyName) ?? (ts.isIdentifier(element.name) ? element.name.text : undefined);
    return member && browserGlobals.has(member) ? [member] : [];
  });
}

function isGlobalObjectReference(node, checker) {
  return ts.isIdentifier(node)
    && globalObjectNames.has(node.text)
    && isUnshadowedIdentifier(node, checker)
    && !isShadowedBySourceBinding(node);
}

function isShadowedBySourceBinding(reference) {
  const sourceFile = reference.getSourceFile();
  let shadowed = false;

  function visit(node) {
    if (node !== reference && ts.isIdentifier(node) && node.text === reference.text && isBindingIdentifier(node)) {
      const scope = bindingScope(node);
      if (scope && scope.pos <= reference.pos && reference.end <= scope.end) shadowed = true;
    }
    if (!shadowed) ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return shadowed;
}

function isBindingIdentifier(node) {
  const parent = node.parent;
  return (ts.isVariableDeclaration(parent) && parent.name === node)
    || (ts.isParameter(parent) && parent.name === node)
    || (ts.isBindingElement(parent) && parent.name === node)
    || (ts.isImportClause(parent) && parent.name === node)
    || (ts.isImportSpecifier(parent) && parent.name === node)
    || (ts.isNamespaceImport(parent) && parent.name === node)
    || (ts.isFunctionDeclaration(parent) && parent.name === node)
    || (ts.isClassDeclaration(parent) && parent.name === node);
}

function bindingScope(node) {
  let current = node.parent;
  while (current) {
    if (ts.isBlock(current) || ts.isSourceFile(current) || ts.isFunctionLike(current)) return current;
    current = current.parent;
  }
  return undefined;
}

function isUnshadowedIdentifier(node, checker) {
  const symbol = checker.getSymbolAtLocation(node);
  return !symbol || !symbol.declarations?.some((declaration) => declaration.getSourceFile() === node.getSourceFile());
}

function isBrowserReference(node, checker) {
  const parent = node.parent;
  if (ts.isDeclarationName(node)) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  if (ts.isMethodDeclaration(parent) && parent.name === node) return false;
  return !checker.getSymbolAtLocation(node);
}

async function findTypeScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return findTypeScriptFiles(path);
    return entry.isFile() && path.endsWith('.ts') ? [path] : [];
  }));
  return files.flat();
}

export async function auditCoreBoundary(coreSourceDirectory) {
  const files = await findTypeScriptFiles(coreSourceDirectory);
  const violationLists = await Promise.all(files.map(async (filePath) => (
    findBoundaryViolations(await readFile(filePath, 'utf8'), filePath)
  )));
  return violationLists.flat();
}

async function main() {
  const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const coreSourceDirectory = resolve(rootDirectory, 'packages/core/src');
  const violations = await auditCoreBoundary(coreSourceDirectory);

  if (violations.length === 0) return;
  for (const violation of violations) console.error(violation.message.replace(rootDirectory, '.'));
  process.exitCode = 1;
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  await main();
}
