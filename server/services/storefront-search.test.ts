import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import StorefrontSearch from '../../src/StorefrontSearch.js';

test('storefront editor search renders an accessible search field', () => {
  const markup = renderToStaticMarkup(createElement(StorefrontSearch));
  assert.match(markup, /Search storefront settings and text/);
  assert.match(markup, /type="search"/);
  assert.match(markup, /id="storefront-editor-search"/);
});
