import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultStorefrontCopy, mergeStorefrontCopy } from '../../shared/storefrontCopy.js';

test('storefront copy defaults remain available when no overrides are saved', () => {
  const copy = mergeStorefrontCopy(undefined);
  assert.deepEqual(copy, defaultStorefrontCopy);
});

test('storefront copy overrides preserve owner-entered text exactly', () => {
  const copy = mergeStorefrontCopy({ contactBody: 'A note with punctuation. And another sentence!' });
  assert.equal(copy.contactBody, 'A note with punctuation. And another sentence!');
  assert.equal(copy.contactTitle, defaultStorefrontCopy.contactTitle);
});

test('storefront copy ignores unknown and non-string persisted fields', () => {
  const copy = mergeStorefrontCopy({ contactTitle: 42, notAField: 'unrecognized' });
  assert.equal(copy.contactTitle, defaultStorefrontCopy.contactTitle);
  assert.equal(Object.hasOwn(copy, 'notAField'), false);
});
