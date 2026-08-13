import assert from 'node:assert/strict';
import test from 'node:test';

test('all built public adapter exports import when browser globals are deleted', async () => {
  const saved = { window: globalThis.window, document: globalThis.document, navigator: globalThis.navigator };
  Reflect.deleteProperty(globalThis, 'window'); Reflect.deleteProperty(globalThis, 'document'); Reflect.deleteProperty(globalThis, 'navigator');
  try {
    const adapters = await Promise.all([
      import('../../react/dist/index.mjs'),
      import('../../preact/dist/index.mjs'),
      import('../../vue/dist/index.mjs'),
      import('../../angular/dist/fesm2022/atqan-qaraa-angular.mjs'),
      import('../../svelte/dist/index.mjs'),
      import('../../solid/dist/index.mjs'),
      import('../../lit/dist/index.mjs'),
    ]);
    assert.equal(adapters.length,7);
  } finally {
    Object.assign(globalThis,saved);
  }
});
