import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ShoppingCharacterFallback from '../../src/ShoppingCharacterFallback.js';

test('shopping assistant has an immediately visible portrait fallback', () => {
  const markup = renderToStaticMarkup(createElement(ShoppingCharacterFallback));
  assert.match(markup, /class="shopping-character"/);
  assert.match(markup, /src="\/beulah-avatar\.jpg"/);
  assert.match(markup, /aria-hidden="true"/);
});
