import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeAliasLayers } from '../aliasLayers.ts';

test('mergeAliasLayers: higher-precedence layer wins on exact-key conflict', () => {
  const map = mergeAliasLayers([{ uh: 'Hawaii' }, { uh: 'Houston' }]);
  assert.equal(map.uh, 'Hawaii');
});

test('mergeAliasLayers: stored repair beats a seed colliding only by normalized identity', () => {
  // `u-h` and `uh` collapse to the same resolver identity; the higher (stored)
  // layer wins and the seed spelling is remapped to the winner (not dropped).
  const map = mergeAliasLayers([{ 'u-h': 'Hawaii' }, { uh: 'Houston' }]);
  assert.equal(map['u-h'], 'Hawaii');
  assert.equal(map.uh, 'Hawaii', 'seed spelling remapped to the stored winner');
});

test('mergeAliasLayers: preserves distinct same-layer spellings', () => {
  const map = mergeAliasLayers([{ 'gulf coast tech': 'Texas', gulfcoasttech: 'Texas' }]);
  assert.equal(map['gulf coast tech'], 'Texas');
  assert.equal(map.gulfcoasttech, 'Texas');
});

test('mergeAliasLayers: lower layer fills identities not claimed by a higher one', () => {
  const map = mergeAliasLayers([{ a: 'A' }, { b: 'B' }]);
  assert.deepEqual(map, { a: 'A', b: 'B' });
});

test('mergeAliasLayers: skips keys that normalize to nothing and non-string targets', () => {
  const map = mergeAliasLayers([{ '  ': 'X', ok: 'Y', bad: 3 as unknown as string }]);
  assert.equal(map.ok, 'Y');
  assert.equal(Object.prototype.hasOwnProperty.call(map, 'bad'), false);
});
