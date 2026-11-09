import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import BeulahAvatar from '../../src/avatar/BeulahAvatar.js';

test('custom chatbot portrait renders as a static circular image', () => {
  const markup = renderToStaticMarkup(createElement(BeulahAvatar, { imageUrl: '/uploads/example/photo.webp' }));
  assert.match(markup, /class="beulah-avatar"/);
  assert.match(markup, /class="beulah-custom-avatar"/);
  assert.match(markup, /src="\/uploads\/example\/photo.webp"/);
  assert.doesNotMatch(markup, /<canvas/);
});

test('default chatbot portrait retains the animated canvas', () => {
  const markup = renderToStaticMarkup(createElement(BeulahAvatar, {}));
  assert.match(markup, /<canvas/);
});
