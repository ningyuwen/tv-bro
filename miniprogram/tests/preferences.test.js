const test = require('node:test')
const assert = require('node:assert/strict')
const { DEFAULT_PREFERENCES, normalizePreferences, readPreferences, savePreferences, motionScale } = require('../lib/preferences')
const key = 'lime-touch-preferences-v1'

function storage() {
  const values = new Map(), calls = []
  return { values, calls, getStorageSync(name) { calls.push(['read', name]); return values.get(name) },
    setStorageSync(name, value) { calls.push(['write', name]); values.set(name, value) } }
}

test('defaults retain the existing pointer and scroll feel and return independent objects', () => {
  assert.deepEqual(DEFAULT_PREFERENCES, { pointerSpeed: 100, scrollSpeed: 100, reverseScroll: false })
  const preferences = normalizePreferences(null)
  preferences.pointerSpeed = 200
  assert.equal(DEFAULT_PREFERENCES.pointerSpeed, 100)
  assert.deepEqual(normalizePreferences(undefined), DEFAULT_PREFERENCES)
  assert.equal(motionScale(undefined, 'move'), 2)
  assert.equal(motionScale(undefined, 'scroll'), -2)
})

test('missing or corrupt stored data falls back to defaults without accepting JSON strings', () => {
  for (const value of [undefined, null, '', '{}', '{broken', JSON.stringify({ pointerSpeed: 200 }),
    100, false, [], [{ pointerSpeed: 200 }], {}]) {
    const wxApi = { getStorageSync(name) { assert.equal(name, key); return value } }
    assert.deepEqual(readPreferences(wxApi), DEFAULT_PREFERENCES)
  }
  assert.deepEqual(readPreferences({ getStorageSync: () => ({ pointerSpeed: '200', scrollSpeed: NaN, reverseScroll: 'true' }) }), DEFAULT_PREFERENCES)
  assert.deepEqual(readPreferences({ getStorageSync: () => ({ pointerSpeed: 150, scrollSpeed: '75', reverseScroll: true }) }),
    { pointerSpeed: 150, scrollSpeed: 100, reverseScroll: true })
})

test('speed requires an integer within 50 to 200 and invalid fields fall back independently', () => {
  for (const value of [undefined, null, '100', true, false, NaN, Infinity, -Infinity, 49, 201, -100,
    0, 100.5, 50.1, 199.9, [], {}, new Number(100)]) {
    assert.deepEqual(normalizePreferences({ pointerSpeed: value, scrollSpeed: value, reverseScroll: true }),
      { pointerSpeed: 100, scrollSpeed: 100, reverseScroll: true })
  }
  for (const value of [undefined, null, 0, 1, 'true', 'false', [], {}, new Boolean(true)]) {
    assert.equal(normalizePreferences({ reverseScroll: value }).reverseScroll, false)
  }
  assert.equal(normalizePreferences({ reverseScroll: true }).reverseScroll, true)
  assert.equal(normalizePreferences({ reverseScroll: false }).reverseScroll, false)
})

test('valid speeds round to the nearest step of 25 including both endpoints', () => {
  for (const [value, expected] of [[50, 50], [62, 50], [63, 75], [75, 75], [87, 75], [88, 100],
    [100, 100], [112, 100], [113, 125], [125, 125], [137, 125], [138, 150], [150, 150],
    [162, 150], [163, 175], [175, 175], [187, 175], [188, 200], [200, 200]]) {
    assert.deepEqual(normalizePreferences({ pointerSpeed: value, scrollSpeed: value }),
      { pointerSpeed: expected, scrollSpeed: expected, reverseScroll: false })
  }
  const input = { pointerSpeed: 63, scrollSpeed: 162, reverseScroll: true }
  normalizePreferences(input)
  assert.deepEqual(input, { pointerSpeed: 63, scrollSpeed: 162, reverseScroll: true })
})

test('saving persists normalized preferences under the dedicated key and drops all text fields', () => {
  const wxApi = storage()
  const input = { pointerSpeed: 162, scrollSpeed: 63, reverseScroll: true, url: 'https://example.com',
    text: 'private typed text', token: 'private token', other: { pointerSpeed: 200 } }
  assert.equal(savePreferences(wxApi, input), true)
  assert.deepEqual(wxApi.values.get(key), { pointerSpeed: 150, scrollSpeed: 75, reverseScroll: true })
  assert.deepEqual(readPreferences(wxApi), { pointerSpeed: 150, scrollSpeed: 75, reverseScroll: true })
  assert.deepEqual(wxApi.calls, [['write', key], ['read', key]])
  input.pointerSpeed = 200
  assert.equal(readPreferences(wxApi).pointerSpeed, 150)
  assert.equal(savePreferences(wxApi, { pointerSpeed: '200', scrollSpeed: 500, reverseScroll: 'false' }), true)
  assert.deepEqual(readPreferences(wxApi), DEFAULT_PREFERENCES)
})

test('storage errors and missing APIs are tolerated and failed writes report false', () => {
  for (const wxApi of [undefined, null, {}, { getStorageSync() { throw Error('read failed') },
    setStorageSync() { throw Error('write failed') } }]) {
    assert.deepEqual(readPreferences(wxApi), DEFAULT_PREFERENCES)
    assert.equal(savePreferences(wxApi, DEFAULT_PREFERENCES), false)
  }
  const wxApi = storage()
  savePreferences(wxApi, { pointerSpeed: 125 })
  wxApi.setStorageSync = () => { throw Error('storage quota exceeded') }
  assert.equal(savePreferences(wxApi, { pointerSpeed: 200 }), false)
  assert.equal(readPreferences(wxApi).pointerSpeed, 125)
})

test('pointer and scroll speeds scale independently and reverse changes only scroll direction', () => {
  for (const speed of [50, 75, 100, 125, 150, 175, 200]) {
    const preferences = { pointerSpeed: speed, scrollSpeed: speed, reverseScroll: false }
    assert.equal(motionScale(preferences, 'move'), speed / 50)
    assert.equal(motionScale(preferences, 'scroll'), -speed / 50)
    preferences.reverseScroll = true
    assert.equal(motionScale(preferences, 'move'), speed / 50)
    assert.equal(motionScale(preferences, 'scroll'), speed / 50)
  }
  const preferences = { pointerSpeed: 50, scrollSpeed: 200, reverseScroll: true }
  assert.equal(motionScale(preferences, 'move'), 1)
  assert.equal(motionScale(preferences, 'scroll'), 4)
  assert.equal(motionScale({ pointerSpeed: 63, scrollSpeed: 162 }, 'move'), 1.5)
  assert.equal(motionScale({ pointerSpeed: 63, scrollSpeed: 162 }, 'scroll'), -3)
  assert.equal(motionScale({ pointerSpeed: '200', scrollSpeed: -50, reverseScroll: 'true' }, 'move'), 2)
  assert.equal(motionScale({ pointerSpeed: '200', scrollSpeed: -50, reverseScroll: 'true' }, 'scroll'), -2)
})

test('menu navigation ignores speeds and reversed scrolling for every allowed setting', () => {
  for (const pointerSpeed of [50, 75, 100, 125, 150, 175, 200]) {
    for (const scrollSpeed of [50, 75, 100, 125, 150, 175, 200]) {
      for (const reverseScroll of [false, true]) {
        const preferences = { pointerSpeed, scrollSpeed, reverseScroll }
        assert.equal(motionScale(preferences, 'move', true), 2)
        assert.equal(motionScale(preferences, 'scroll', true), -2)
      }
    }
  }
  assert.equal(motionScale(null, 'move', true), 2)
  assert.equal(motionScale(null, 'scroll', true), -2)
  assert.equal(motionScale({ reverseScroll: true }, 'scroll', false), 2)
})
