import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeError } from './errors.ts';

test('reads a plugin transport error, including one wrapped as a cause', () => {
  const transport = new Error('transport failed');
  transport.name = 'PluginTransportError';
  Object.assign(transport, { payload: { code: 'HTTP_ERROR', status: 403, message: 'Forbidden' } });
  assert.equal(describeError(transport), 'HTTP_ERROR 403 Forbidden');

  const wrapped = new Error('Failed to list storages');
  wrapped.cause = transport;
  assert.equal(describeError(wrapped), 'HTTP_ERROR 403 Forbidden');
});

test('falls back to the error message', () => {
  assert.equal(describeError(new Error('Network down')), 'Network down');
  assert.equal(describeError('nope'), 'Something went wrong.');
});
