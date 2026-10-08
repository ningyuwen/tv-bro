const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { emptyVolume, volumeView } = require('../lib/volume')

function page() {
  let p
  const calls = [], toasts = []
  vm.runInNewContext(fs.readFileSync(require.resolve('../pages/remote/remote.js'), 'utf8'), {
    require: path => require(path.replace('../../lib/', '../lib/')),
    Page: value => { p = value }, wx: { showToast: value => toasts.push(value) },
    setTimeout, clearTimeout, setInterval, clearInterval, Date
  })
  p.setData = values => {
    for (const [key, value] of Object.entries(values)) {
      if (key.startsWith('volume.')) p.data.volume[key.slice(7)] = value
      else p.data[key] = value
    }
  }
  p.volumePollEpoch = 1
  p.volumeRevision = 1
  p.volumeSupported = true
  p.data.connected = true
  p.data.volume = volumeView(current())
  p.client = { canRequest: () => true, request: async (op, fields) => {
    calls.push({ op, fields })
    return { volume: current(fields && fields.percent !== undefined ? fields.percent : 40, fields && fields.muted) }
  } }
  function current(percent = 40, muted = false) { return { supported: true, percent, muted: !!muted } }
  return { p, calls, toasts, current }
}

test('invalid state and fixed volume never enable volume controls', () => {
  assert.equal(emptyVolume().supported, false)
  for (const value of [null, {}, { supported: true, percent: 101, muted: false },
    { supported: true, percent: '50', muted: false }, { supported: true, percent: 50, muted: 'false' }]) {
    assert.equal(volumeView(value).supported, false)
  }
  const fixed = volumeView({ supported: false, percent: 100, muted: false })
  assert.equal(fixed.ready, true)
  assert.equal(fixed.supported, false)
  assert.match(fixed.hint, /固定音量/)
})

test('drag previews locally, sends once on release and restores actual box value', async () => {
  const { p, calls } = page()
  p.volumeStart()
  p.volumeChanging({ detail: { value: 65 } })
  assert.equal(p.data.volume.percent, 65)
  assert.equal(calls.length, 0)
  await p.volumeChange({ detail: { value: 70 } })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].op, 'setVolume')
  assert.equal(calls[0].fields.percent, 70)
  assert.equal(p.data.volume.percent, 70)
})

test('mute switch sends explicit state and can unmute without replaying a toggle', async () => {
  const { p, calls } = page()
  await p.muteChange({ detail: { value: true } })
  assert.equal(p.data.volume.muted, true)
  await p.muteChange({ detail: { value: false } })
  assert.equal(p.data.volume.muted, false)
  assert.deepEqual(calls.map(call => [call.op, call.fields.muted]), [['setMuted', true], ['setMuted', false]])
})

test('cancelling or disconnecting during drag never sends a volume change', async () => {
  const { p, calls } = page()
  p.volumeStart()
  p.volumeChanging({ detail: { value: 90 } })
  p.volumeCancel()
  assert.equal(p.data.volume.percent, 40)
  await p.volumeChange({ detail: { value: 90 } })
  p.volumeStart()
  p.stopVolumePolling()
  await p.volumeChange({ detail: { value: 90 } })
  assert.equal(calls.length, 0)
})

test('polling refreshes hardware changes and late status cannot overwrite a command', async () => {
  const { p, current } = page()
  let resolveStatus
  p.client.request = op => op === 'volumeStatus' ? new Promise(resolve => { resolveStatus = resolve })
    : Promise.resolve({ volume: current(75) })
  p.startVolumePolling()
  resolveStatus({ volume: current() })
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setTimeout(resolve, 1050))
  await p.volumeCommand('setVolume', { percent: 75 })
  resolveStatus({ volume: current(20) })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(p.data.volume.percent, 75)
  p.stopVolumePolling()
  p.client.request = async () => ({ volume: current(33, true) })
  p.startVolumePolling()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(p.data.volume.percent, 33)
  assert.equal(p.data.volume.muted, true)
  p.stopVolumePolling()
})

test('in-flight polling cannot move the slider while dragging', async () => {
  const { p, current } = page()
  let resolveStatus
  p.client.request = () => new Promise(resolve => { resolveStatus = resolve })
  p.startVolumePolling()
  resolveStatus({ volume: current(40) })
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setTimeout(resolve, 1050))
  p.volumeStart()
  p.volumeChanging({ detail: { value: 80 } })
  resolveStatus({ volume: current(20) })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(p.data.volume.percent, 80)
  p.stopVolumePolling()
})

test('touching without changing volume releases the drag and restores polling', async () => {
  const { p } = page()
  p.volumeStart()
  p.volumeEnd()
  await new Promise(resolve => setTimeout(resolve, 550))
  assert.equal(p.volumeDrag, null)
  assert.equal(p.data.volume.percent, 40)
})

test('errors recover without replay and late replies from old connections are ignored', async () => {
  const { p, calls, toasts, current } = page()
  p.client.request = async () => { calls.push('setVolume'); throw Error('操作超时') }
  await p.volumeCommand('setVolume', { percent: 60 })
  assert.equal(calls.length, 1)
  assert.equal(toasts.length, 1)
  assert.equal(p.data.volumeBusy, false)
  p.data.volume = volumeView(current())
  let resolveCommand
  p.client.request = () => new Promise(resolve => { resolveCommand = resolve })
  const pending = p.volumeCommand('setVolume', { percent: 80 })
  p.stopVolumePolling()
  resolveCommand({ volume: current(80) })
  await pending
  assert.equal(p.data.volume.ready, false)
})

test('old browsers show an update hint without sending unsupported commands', async () => {
  const { p, calls } = page()
  p.volumeSupported = false
  p.startVolumePolling()
  await p.volumeCommand('setVolume', { percent: 50 })
  assert.match(p.data.volume.hint, /更新/)
  assert.equal(calls.length, 0)
})
