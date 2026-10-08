// Evaluated on demand in the current tab, including incognito. State stays in memory.
(function(action, seconds, expectedId, deadline) {
    if (Date.now() > deadline) return { error: 'not_ready' };
    var state = window.__limeMediaState;
    if (!state) state = window.__limeMediaState = {
        prefix: Date.now().toString(36) + Math.random().toString(36).slice(2),
        sequence: 0, identities: new WeakMap()
    };
    var candidates = [], visited = [];
    function collect(root, depth) {
        if (!root || depth > 12 || visited.indexOf(root) >= 0) return;
        visited.push(root);
        Array.prototype.forEach.call(root.querySelectorAll('video, audio'), function(media) {
            var rect = media.getBoundingClientRect();
            var area = Math.max(0, rect.width) * Math.max(0, rect.height);
            var view = media.ownerDocument.defaultView;
            var visible = area > 0 && (!view ||
                (rect.bottom > 0 && rect.right > 0 && rect.top < view.innerHeight && rect.left < view.innerWidth));
            if (visible && view && view.getComputedStyle) {
                var style = view.getComputedStyle(media);
                visible = style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.opacity !== '0';
            }
            var playing = !media.paused && !media.ended;
            var full = media.ownerDocument.fullscreenElement;
            var fullscreen = full && (full === media || full.contains(media));
            candidates.push({ media: media, score: (fullscreen ? 1e12 : 0) +
                (visible ? 1e11 : 0) + (playing ? 1e10 : 0) +
                (media.readyState > 0 ? 1e8 : 0) + Math.min(area, 1e7) });
        });
        // Same-origin frames and open shadow roots; cross-origin frames remain isolated.
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
        if (!candidates.length) return action === 'mediaStatus' ? { available: false } : { error: 'no_media' };
        var media = candidates[0].media;
        var identity = state.identities.get(media);
        var source = media.currentSrc || media.src || '';
        if (!identity || identity.source !== source) {
            identity = { id: state.prefix + '-' + (++state.sequence), source: source };
            state.identities.set(media, identity);
        }
        if (action !== 'mediaStatus' && expectedId !== identity.id) return { error: 'media_changed' };
        var duration = Number.isFinite(media.duration) && media.duration > 0 ? media.duration : null;
        var ranges = [];
        if (duration !== null) for (var i = 0; i < media.seekable.length; i++) {
            var start = Math.max(0, media.seekable.start(i));
            var end = Math.min(duration, media.seekable.end(i));
            if (Number.isFinite(start) && Number.isFinite(end) && end > start) ranges.push({ start: start, end: end });
        }
        if (action === 'seekBy' || action === 'seekTo') {
            if (!ranges.length) return { error: 'media_not_seekable' };
            var target = action === 'seekBy' ? media.currentTime + seconds : seconds;
            if (!Number.isFinite(target)) return { error: 'invalid_seek' };
            // Clamp to the nearest valid range, including gaps and the start/end of a video.
            var nearest = ranges[0].start, distance = Infinity;
            ranges.forEach(function(range) {
                var clamped = Math.max(range.start, Math.min(range.end, target));
                if (Math.abs(clamped - target) < distance) { nearest = clamped; distance = Math.abs(clamped - target); }
            });
            media.currentTime = nearest;
        } else if (action === 'mediaToggle') {
            if (!media.paused && !media.ended) media.pause();
            else {
                var play = media.play();
                if (play && play.catch) play.catch(function() {});
            }
        } else if (action !== 'mediaStatus') return { error: 'media_unsupported' };
        return { available: true, mediaId: identity.id, paused: media.paused || media.ended,
            position: Number.isFinite(media.currentTime) ? Math.max(0, media.currentTime) : 0,
            duration: duration, canSeek: ranges.length > 0,
            seekStart: ranges.length ? ranges[0].start : 0,
            seekEnd: ranges.length ? ranges[ranges.length - 1].end : 0 };
    } catch (_) { return { error: 'media_failed' }; }
})
