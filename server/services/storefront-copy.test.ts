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

test('replaces only the obsolete UPI checkout message', () => {
  const legacy = {
    checkoutUpiNote: 'UPI opens directly in your app Payment remains pending until AHUZA manually verifies the bank settlement',
    payAppOpened: 'Payment page opened After paying, return here Your order is confirmed automatically as soon as the bank credit is matched',
  };
  const merged = mergeStorefrontCopy(legacy);
  assert.equal(merged.checkoutUpiNote, defaultStorefrontCopy.checkoutUpiNote);
  assert.equal(merged.payAppOpened, defaultStorefrontCopy.payAppOpened);
  assert.equal(mergeStorefrontCopy({ checkoutUpiNote: 'Payment remains pending until Instamojo confirms it' }).checkoutUpiNote, defaultStorefrontCopy.checkoutUpiNote);
  assert.equal(mergeStorefrontCopy({ checkoutUpiNote: 'Custom payment information' }).checkoutUpiNote, 'Custom payment information');
});
