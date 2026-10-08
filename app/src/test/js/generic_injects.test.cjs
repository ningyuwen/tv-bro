const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '../../main/assets/generic_injects.js'), 'utf8');

function page() {
    class HTMLMediaElement {}
    const media = Object.assign(new HTMLMediaElement(), {
        currentTime: 20, paused: false, ended: false, readyState: 4,
        play() { this.paused = false; },
        pause() { this.paused = true; }
    });
    const documentListeners = [];
    const windowListeners = [];
    const context = vm.createContext({
        HTMLMediaElement,
        document: {
            addEventListener: (...args) => documentListeners.push(args),
            querySelector: selector => selector === 'video' ? media : null
        },
        window: { addEventListener: (...args) => windowListeners.push(args) }
    });
    return {
        context, media, documentListeners, windowListeners,
        inject: () => vm.runInContext(script, context)
    };
}

test('repeated page-finished injection keeps controls working without duplicate listeners', () => {
    const p = page();
    p.inject();
    p.inject();
    assert.equal(p.documentListeners.length, 1);
    assert.equal(p.windowListeners.length, 1);
    p.context.window.tvBroTogglePlayback();
    assert.equal(p.media.paused, true);
    p.context.window.tvBroTogglePlayback();
    assert.equal(p.media.paused, false);
});

test('playback controls tolerate a page-owned non-configurable playing property', () => {
    const p = page();
    const getter = () => { throw new Error('page-owned getter must not be used'); };
    Object.defineProperty(p.context.HTMLMediaElement.prototype, 'playing', { get: getter });
    p.inject();
    p.inject();
    p.context.window.tvBroTogglePlayback();
    assert.equal(p.media.paused, true);
    assert.equal(Object.getOwnPropertyDescriptor(p.context.HTMLMediaElement.prototype, 'playing').get, getter);
});

test('stop and seeking preserve media control behavior after repeated injection', () => {
    const p = page();
    p.inject();
    p.inject();
    p.context.window.tvBroRewind();
    assert.equal(p.media.currentTime, 10);
    p.context.window.tvBroFastForward();
    assert.equal(p.media.currentTime, 20);
    p.context.window.tvBroStopPlayback();
    assert.equal(p.media.paused, true);
    assert.equal(p.media.currentTime, 0);
    p.context.window.tvBroTogglePlayback();
    assert.equal(p.media.paused, false);
});

test('touch tracking records the target and coordinates once after repeated injection', () => {
    const p = page();
    p.inject();
    p.inject();
    const target = {};
    const listeners = p.windowListeners.filter(([type]) => type === 'touchstart');
    assert.equal(listeners.length, 1);
    listeners[0][1]({ target, touches: [{ clientX: 120, clientY: 240 }] });
    assert.equal(p.context.window.TVBRO_activeElement, target);
    assert.equal(p.context.window.TVBRO_touchStartX, 120);
    assert.equal(p.context.window.TVBRO_touchStartY, 240);
});
