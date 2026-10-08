// Run separately with Playwright and a Chromium installation; see miniprogram/README.md.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { chromium } = require('playwright')
const source = fs.readFileSync(require.resolve('../../../app/common/src/main/assets/extensions/generic/remote_scroll.js'), 'utf8')
let browser
before(async () => { browser = await chromium.launch({ executablePath: process.env.CHROME_PATH }) })
after(async () => { await browser?.close() })
async function fixture(t, extra = '') {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
  t.after(() => page.close())
  await page.setContent(`<style>
    html,body {margin:0} body {height:2400px}
    #carousel {margin-top:100px; width:500px; height:150px; overflow-x:auto; overflow-y:hidden; display:flex}
    #carousel > div {flex:0 0 200px; height:120px; background:lightgreen}
  </style><div id="carousel">${'<div>item</div>'.repeat(8)}</div>${extra}`)
  await page.evaluate(source + '; window.wheels=0; document.addEventListener("wheel", e => { window.wheels++; e.preventDefault(); document.querySelector("#carousel").scrollLeft+=e.deltaY }, {passive:false})')
  return page
}
const run = (page, dx, dy, id = 'gesture', x = 100, y = 150) => page.evaluate(
  args => limeRemoteScroll(...args), [x, y, dx, dy, id])
const position = page => page.evaluate(() => ({ top: document.scrollingElement.scrollTop,
  left: document.querySelector('#carousel').scrollLeft, wheels: window.wheels }))

test('vertical scrolling over a horizontal carousel bypasses wheel remapping and scrolls the page', async t => {
  const p = await fixture(t)
  await run(p, 1, 160)
  assert.deepEqual(await position(p), { top: 160, left: 0, wheels: 0 })
  await run(p, 90, 100)
  assert.deepEqual(await position(p), { top: 260, left: 0, wheels: 0 })
})

test('an expired renderer command does not scroll or replace the current gesture', async t => {
  const p = await fixture(t)
  await run(p, 100, 0, 'active')
  assert.equal(await p.evaluate(() => limeRemoteScroll(100, 150, 0, 200, 'expired', Date.now() - 1)), false)
  assert.deepEqual(await position(p), { top: 0, left: 100, wheels: 0 })
  await run(p, 100, 0, 'active')
  assert.equal((await position(p)).left, 200)
})

test('horizontal scrolling stays in the carousel at its boundary and a new gesture can scroll vertically', async t => {
  const p = await fixture(t)
  await run(p, 300, 1)
  assert.deepEqual(await position(p), { top: 0, left: 300, wheels: 0 })
  for (let i = 0; i < 6; i++) await run(p, 500, 0)
  assert.deepEqual(await position(p), { top: 0, left: 1100, wheels: 0 })
  await run(p, 0, 150) // Opposite-axis packets within the old gesture are discarded.
  assert.equal((await position(p)).top, 0)
  await run(p, 0, 150, 'next')
  assert.equal((await position(p)).top, 150)
})

test('a gesture pins its target even when content moves under the cursor; detached targets are dropped', async t => {
  const p = await fixture(t)
  await run(p, 100, 0)
  await p.evaluate(() => { document.querySelector('#carousel').style.marginTop = '700px' })
  await run(p, 100, 0)
  assert.equal((await position(p)).left, 200)
  await p.evaluate(() => {
    const old = document.querySelector('#carousel'); const next = old.cloneNode(true)
    old.replaceWith(next); next.style.marginTop = '100px'
  })
  await run(p, 100, 0)
  assert.equal((await position(p)).left, 0)
  await run(p, 100, 0, 'next')
  assert.equal((await position(p)).left, 100)
})

test('scroll-snap retains accumulated intent rather than swallowing small packets', async t => {
  const p = await fixture(t)
  await p.addStyleTag({ content: '#carousel{scroll-snap-type:x mandatory} #carousel>div{scroll-snap-align:start}' })
  for (let i = 0; i < 10; i++) await run(p, 20, 0)
  assert.equal((await position(p)).left, 200)
})

test('RTL horizontal lists use negative offsets and never move the page', async t => {
  const p = await fixture(t)
  await p.addStyleTag({ content: '#carousel{direction:rtl}' })
  await run(p, -200, 0)
  assert.deepEqual(await position(p), { top: 0, left: -200, wheels: 0 })
})

test('body overflow:hidden preserves a modal background scroll lock', async t => {
  const p = await fixture(t)
  await p.addStyleTag({ content: 'body{overflow:hidden}' })
  await run(p, 0, 200)
  assert.deepEqual(await position(p), { top: 0, left: 0, wheels: 0 })
})

test('native coordinates and distances are converted for display density and page zoom', async t => {
  const p = await fixture(t)
  await p.evaluate(() => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 2 })
    Object.defineProperty(window, 'visualViewport', { value: { scale: 2 } })
  })
  await run(p, 400, 0, 'scaled', 400, 600)
  assert.equal((await position(p)).left, 100)
})

test('same-origin iframe scrolls its own vertical container instead of the outer page', async t => {
  const p = await fixture(t)
  await p.setContent('<style>html,body{margin:0}body{height:2400px}iframe{position:absolute;left:0;top:50px;width:500px;height:250px}</style><iframe srcdoc="<style>html,body{margin:0}body{height:1500px}#list{height:120px;width:450px;overflow-x:auto;overflow-y:hidden}#row{width:1500px;height:100px}</style><div id=list><div id=row>row</div></div>"></iframe>')
  await p.evaluate(source)
  await run(p, 0, 160, 'frame', 100, 100)
  assert.deepEqual(await p.evaluate(() => ({ outer: document.scrollingElement.scrollTop,
    inner: document.querySelector('iframe').contentDocument.scrollingElement.scrollTop })), { outer: 0, inner: 160 })
})

test('opaque cross-origin frames safely route vertical scrolling to the accessible outer page', async t => {
  const p = await fixture(t)
  await p.setContent('<style>html,body{margin:0}body{height:2400px}</style><iframe style="width:500px;height:200px" src="data:text/html,opaque"></iframe>')
  await p.evaluate(source)
  await run(p, 0, 160, 'opaque', 100, 100)
  assert.equal(await p.evaluate(() => document.scrollingElement.scrollTop), 160)
})

test('open shadow-root lists receive horizontal scrolling and vertical gestures find the outer page', async t => {
  const p = await fixture(t)
  await p.evaluate(() => {
    const host = document.querySelector('#carousel')
    host.innerHTML = ''; host.style.display = 'block'
    host.attachShadow({ mode: 'open' }).innerHTML = '<style>#list{width:450px;height:120px;overflow-x:auto;overflow-y:hidden}#row{width:1500px;height:100px}</style><div id=list><div id=row>row</div></div>'
  })
  await run(p, 200, 0)
  assert.equal(await p.evaluate(() => document.querySelector('#carousel').shadowRoot.querySelector('#list').scrollLeft), 200)
  await run(p, 0, 150, 'vertical')
  assert.equal((await position(p)).top, 150)
})
