// Arm a single native F8 key event so requestFullscreen runs with user activation.
(function(action, token, deadline) {
    var previous = window.__limeFullscreen;
    if (action === 'poll') return previous && previous.token === token ? previous.result : { error: 'not_ready' };
    if (previous) previous.cancel();
    if (action === 'cancel' || Date.now() > deadline) return { error: 'not_ready' };
    var roots = [], windows = [], candidates = [];
    function collect(root, depth) {
        if (!root || depth > 12 || roots.indexOf(root) >= 0) return;
        roots.push(root);
        var win = root.defaultView;
        if (win && windows.indexOf(win) < 0) windows.push(win);
        Array.prototype.forEach.call(root.querySelectorAll('video'), function(video) {
            var rect = video.getBoundingClientRect(), view = video.ownerDocument.defaultView;
            var area = Math.max(0, rect.width) * Math.max(0, rect.height);
            var visible = area > 0 && (!view || (rect.bottom > 0 && rect.right > 0 &&
                rect.top < view.innerHeight && rect.left < view.innerWidth));
            if (visible && view && view.getComputedStyle) {
                var style = view.getComputedStyle(video);
                visible = style.display !== 'none' && style.visibility !== 'hidden' &&
                    style.visibility !== 'collapse' && style.opacity !== '0';
            }
            if (visible) candidates.push({ video: video, score: (!video.paused && !video.ended ? 1e10 : 0) + area });
        });
        Array.prototype.forEach.call(root.querySelectorAll('*'), function(element) {
            if (element.shadowRoot) collect(element.shadowRoot, depth + 1);
            if (element.tagName === 'IFRAME' || element.tagName === 'FRAME') {
                try { collect(element.contentDocument, depth + 1); } catch (_) {}
            }
        });
    }
    try {
        collect(document, 0);
        candidates.sort(function(a, b) { return b.score - a.score; });
        if (!candidates.length) return { error: 'no_media' };
        var video = candidates[0].video;
        var request = video.requestFullscreen || video.webkitRequestFullscreen;
        if (!request || video.ownerDocument.fullscreenEnabled === false) return { error: 'fullscreen_unsupported' };
        var source = video.currentSrc || video.src || '';
        var state = { token: token, result: { pending: true }, cancel: cleanup };
        var timer;
        function removeListeners() {
            windows.forEach(function(win) {
                win.removeEventListener('keydown', onKey, true);
                win.removeEventListener('keyup', onKeyUp, true);
            });
        }
        function cleanup() {
            clearTimeout(timer);
            removeListeners();
            if (state.result.pending) state.result = { error: 'not_ready' };
        }
        function onKeyUp(event) {
            if (event.key !== 'F8' || !event.isTrusted) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            removeListeners();
        }
        function onKey(event) {
            if (event.key !== 'F8' || !event.isTrusted) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            windows.forEach(function(win) { win.removeEventListener('keydown', onKey, true); });
            if (Date.now() > deadline || !video.isConnected || (video.currentSrc || video.src || '') !== source) {
                state.result = { error: 'media_changed' };
                return;
            }
            try {
                var result = request.call(video);
                // Key-up removes listeners but must not complete a pending fullscreen request.
                state.result = { pending: true };
                Promise.resolve(result).then(function() {
                    if (!state.result.pending || Date.now() > deadline) return;
                    state.result = video.ownerDocument.fullscreenElement || video.ownerDocument.webkitFullscreenElement ?
                        { fullscreen: true } : { error: 'fullscreen_failed' };
                }, function() { if (state.result.pending) state.result = { error: 'fullscreen_failed' }; });
            } catch (_) { state.result = { error: 'fullscreen_failed' }; }
        }
        window.__limeFullscreen = state;
        windows.forEach(function(win) {
            win.addEventListener('keydown', onKey, true);
            win.addEventListener('keyup', onKeyUp, true);
        });
        timer = setTimeout(cleanup, Math.max(0, deadline - Date.now()));
        video.ownerDocument.defaultView.focus();
        return { pending: true };
    } catch (_) { return { error: 'fullscreen_failed' }; }
})
