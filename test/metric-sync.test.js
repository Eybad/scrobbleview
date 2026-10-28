import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQueryParams, serializeMetricParam, resolveMetric } from '../app/state-metric.js';

test('resolveMetric: defaults to ms (Tiempo escuchado)', () => {
  assert.equal(resolveMetric(null, null), 'ms');
  assert.equal(resolveMetric('', ''), 'ms');
  assert.equal(resolveMetric('invalid', 'garbage'), 'ms');
});

test('resolveMetric: URL query parameter takes precedence over stored preference', () => {
  assert.equal(resolveMetric('plays', 'ms'), 'plays');
  assert.equal(resolveMetric('ms', 'plays'), 'ms');
});

test('resolveMetric: falls back to stored preference when query parameter is absent', () => {
  assert.equal(resolveMetric(null, 'plays'), 'plays');
  assert.equal(resolveMetric(undefined, 'ms'), 'ms');
});

test('parseQueryParams: extracts m or metric parameter from query string', () => {
  assert.equal(parseQueryParams('m=plays').metric, 'plays');
  assert.equal(parseQueryParams('metric=ms&other=1').metric, 'ms');
  assert.equal(parseQueryParams('foo=bar').metric, null);
});

test('serializeMetricParam: serializes metric cleanly for URL hash', () => {
  assert.equal(serializeMetricParam('plays'), 'm=plays');
  assert.equal(serializeMetricParam('ms'), 'm=ms');
});
