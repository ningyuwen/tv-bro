const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const template = fs.readFileSync(require.resolve('../pages/remote/remote.wxml'), 'utf8')

function page() {
  let p
  const calls = [], patches = [], scans = []
  const wx = { showToast() {}, getStorageSync() {}, scanCode: options => scans.push(options) }
  vm.runInNewContext(fs.readFileSync(require.resolve('../pages/remote/remote.js'), 'utf8'), {
    require: path => require(path.replace('../../lib/', '../lib/')),
    Page: value => { p = value }, wx, setTimeout, clearTimeout, Date
  })
  p.setData = values => {
    patches.push(values)
    for (const [path, value] of Object.entries(values)) {
      const keys = path.split('.'), key = keys.pop()
      keys.reduce((object, part) => object[part], p.data)[key] = value
    }
  }
  p.epoch = 1; p.visible = true; p.data.connected = true
  p.client = { request: (op, fields) => new Promise((resolve, reject) => calls.push({ op, fields, resolve, reject })) }
  p.discovery = { stop() {} }
  return { p, calls, patches, scans }
}

function bindings(data, attribute) {
  return [...template.matchAll(/<(button|slider|switch)\b[^>]*>/g)].map(([tag]) => {
    const match = tag.match(new RegExp(attribute + '="\\{\\{([\\s\\S]*?)\\}\\}"'))
    return match ? !!vm.runInNewContext(match[1], { ...data, item: data.websites[0] }) : false
  })
}

test('pending requests and quality switches preserve sibling control appearance', () => {
  const { p } = page()
  p.data.media = { ...p.data.media, available: true, canSeek: true,
    quality: { ...p.data.media.quality, supported: true } }
  p.data.volume.supported = true
  const idle = bindings(p.data, 'disabled')
  for (const state of [{ busy: true }, { openingWebsite: 'youtube' }, { mediaBusy: true },
    { volumeBusy: true }, { media: { ...p.data.media, quality: { ...p.data.media.quality, switching: true } } }]) {
    assert.deepEqual(bindings({ ...p.data, ...state }, 'disabled'), idle)
  }
  // Unavailable media and unsupported hardware must still look disabled.
  assert.notDeepEqual(bindings({ ...p.data, media: { ...p.data.media, canSeek: false, available: false } }, 'disabled'), idle)
  assert.notDeepEqual(bindings({ ...p.data, volume: { ...p.data.volume, supported: false } }, 'disabled'), idle)
})

test('only the active connection action shows a loading indicator', () => {
  const { p } = page()
  for (const connectionAction of ['find', 'connect', 'device']) {
    const loading = bindings({ ...p.data, busy: true, connectionAction }, 'loading')
    assert.equal(loading.filter(Boolean).length, connectionAction === 'device' ? 0 : 1)
    assert.equal(bindings({ ...p.data, busy: false, connectionAction }, 'loading').some(Boolean), false)
  }
})

test('website shortcuts serialize requests and recover after a failed open', async () => {
  const { p, calls } = page()
  const tap = id => ({ currentTarget: { dataset: { id } } })
  const pending = p.openWebsite(tap('youtube'))
  await p.openWebsite(tap('netflix'))
  assert.equal(calls.length, 1)
  assert.equal(p.data.openingWebsite, 'youtube')
  calls[0].reject(Error('超时')); await pending
  assert.equal(p.data.openingWebsite, '')
  const retry = p.openWebsite(tap('bilibili'))
  assert.equal(calls.length, 2)
  calls[1].resolve({}); await retry
})

test('connection controls and scanner ignore competing taps without disabled bindings', async () => {
  const { p, scans } = page()
  p.data.connected = false
  let finish, attempts = 0
  p.attach = () => { attempts++; return new Promise(resolve => { finish = resolve }) }
  const pending = p.connect()
  await p.find(); await p.choose({ host: '192.168.1.2' }); await p.connect(); p.scan()
  assert.equal(attempts, 1); assert.equal(scans.length, 0)
  finish(); await pending
  p.scan(); p.scan()
  await p.connect(); await p.find(); await p.choose({ host: '192.168.1.2' })
  assert.equal(scans.length, 1); assert.equal(attempts, 1)
  scans[0].complete()
  const retry = p.connect(); assert.equal(attempts, 2)
  finish(); await retry
})
