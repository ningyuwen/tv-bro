// Best-effort adapters for the selected media only. Never return source URLs or player IDs.
(function(media, action, qualityId, state) {
    if (!state.qualities) { state.qualities = new WeakMap(); state.qualitySequence = 0; }
    var previous = state.qualities.get(media);
    var view = media.ownerDocument.defaultView || window;
    function height(value) {
        return Number.isInteger(value) && value > 0 && value <= 16384 ? value : 0;
    }
    function bitrate(value) {
        return Number.isFinite(value) && value > 0 && value <= 1e9 ? value : 0;
    }
    function label(level) {
        var h = height(level.height), b = bitrate(level.bitrate);
        return h ? h + 'P' : b ? Math.round(b / 1000) + ' kbps' : '';
    }
    function youtubeAdapter() {
        // These are methods on YouTube's own DOM player, not the deprecated iframe API.
        var host = view.location && view.location.hostname;
        if (!host || !/(^|\.)youtube(?:-nocookie)?\.com$/i.test(host) ||
            media.tagName !== 'VIDEO' || typeof media.closest !== 'function') return;
        var player = media.closest('.html5-video-player');
        if (!player || !player.contains(media) ||
            player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting') ||
            typeof player.getAvailableQualityLevels !== 'function' ||
            typeof player.setPlaybackQualityRange !== 'function' || typeof player.getVideoData !== 'function') return;
        var data = player.getVideoData(), videoId = data && data.video_id;
        if (typeof videoId !== 'string' || !/^[\w-]{1,128}$/.test(videoId)) return;
        var available = player.getAvailableQualityLevels();
        if (!Array.isArray(available) || available.length < 1 || available.length > 32) return;
        var heights = { tiny: 144, small: 240, medium: 360, large: 480,
            hd720: 720, hd1080: 1080, hd1440: 1440, hd2160: 2160, hd2880: 2880, highres: 4320 };
        var levels = [];
        available.forEach(function(key) {
            if (typeof key === 'string' && Object.prototype.hasOwnProperty.call(heights, key) &&
                !levels.some(function(level) { return level.key === key; })) {
                levels.push({ key: key, height: heights[key] });
            }
        });
        if (!levels.length) return;
        // Keep catalog IDs stable if the player merely changes its array ordering.
        levels.sort(function(a, b) { return b.height - a.height; });
        return { ref: player, kind: 'youtube', auto: true, levels: levels,
            signature: JSON.stringify([videoId, levels]),
            // getPlaybackQuality() reports the decoded tier, not the user's preference.
            // Leave the initial preference unknown; report only a choice made here.
            selected: function(record) {
                return Number.isInteger(record.requestedIndex) ? record.requestedIndex : -2;
            },
            select: function(index, record) {
                var key = index === -1 ? 'auto' : levels[index].key;
                player.setPlaybackQualityRange(key, key);
                record.requestedIndex = index;
            }
        };
    }
    function hlsAdapter() {
        var players = [media.hls, media._hls, view.hls];
        for (var p = 0; p < players.length; p++) {
            var player = players[p];
            if (!player || player.media !== media || !Array.isArray(player.levels) ||
                player.levels.length < 2 || player.levels.length > 32) continue;
            var levels = player.levels;
            if (!levels.every(function(level) { return !!label(level); })) continue;
            return { ref: player, kind: 'hls', auto: true, levels: levels,
                signature: JSON.stringify(levels.map(function(level) {
                    return [level.height, level.bitrate, level.url, level.videoCodec];
                })),
                selected: function() {
                    return player.autoLevelEnabled || player.manualLevel === -1 ? -1 :
                        Number.isInteger(player.manualLevel) ? player.manualLevel : player.currentLevel;
                },
                select: function(index) { player.currentLevel = index; }
            };
        }
    }
    function videojsAdapter() {
        if (!view.videojs || typeof view.videojs.getPlayers !== 'function') return;
        var players = view.videojs.getPlayers(), keys = Object.keys(players).slice(0, 64);
        for (var p = 0; p < keys.length; p++) {
            var player = players[keys[p]];
            if (!player || typeof player.el !== 'function' || !player.el() ||
                !player.el().contains(media) || typeof player.qualityLevels !== 'function') continue;
            var list = player.qualityLevels();
            if (!list || list.length < 2 || list.length > 32) continue;
            var levels = Array.prototype.slice.call(list);
            if (!levels.every(function(level) { return !!label(level) && typeof level.enabled === 'boolean'; })) continue;
            return { ref: list, kind: 'videojs', auto: true, levels: levels,
                signature: JSON.stringify(levels.map(function(level) { return [level.id, level.height, level.bitrate]; })),
                selected: function() {
                    var enabled = levels.map(function(level, i) { return level.enabled ? i : -1; })
                        .filter(function(i) { return i >= 0; });
                    // A site may impose a subset. Do not misrepresent that as automatic selection.
                    return enabled.length === levels.length ? -1 : enabled.length === 1 ? enabled[0] : -2;
                },
                select: function(index) {
                    // Enable the target before disabling the others so there is always a usable level.
                    if (index >= 0) levels[index].enabled = true;
                    levels.forEach(function(level, i) { level.enabled = index === -1 || i === index; });
                }
            };
        }
    }
    function sourcesAdapter() {
        if (media.tagName !== 'VIDEO' || media.mediaKeys || !Number.isFinite(media.duration) || media.duration <= 0 ||
            !media.querySelectorAll || typeof media.load !== 'function') return;
        var nodes = media.querySelectorAll('source');
        if (nodes.length < 2 || nodes.length > 32) return;
        var sources = [];
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            var raw = node.getAttribute('data-res') || node.getAttribute('res') || node.getAttribute('size') ||
                node.getAttribute('label') || '';
            var match = /^(\d{3,4})p?$/i.exec(raw.trim());
            var type = node.getAttribute('type') || '';
            // Multiple <source> elements are often codec fallbacks, not quality choices.
            // Only explicitly labelled, playable MP4/WebM variants qualify.
            if (!match || !height(Number(match[1])) || !/^https?:\/\//i.test(node.src) ||
                !/^video\/(mp4|webm)(;|$)/i.test(type) || !media.canPlayType(type)) continue;
            sources.push({ height: Number(match[1]), bitrate: 0, url: node.src });
        }
        if (sources.length < 2 || new Set(sources.map(function(source) { return source.height; })).size < 2) return;
        // Never replace an unrelated MSE/blob stream or a site's separate active source.
        var current = media.currentSrc || media.src;
        if (!sources.some(function(source) { return source.url === current; }) &&
            !(previous && previous.pending && sources.some(function(source) { return source.url === media.src; }))) return;
        return { ref: media, kind: 'sources', auto: false, levels: sources,
            signature: JSON.stringify(sources),
            selected: function() {
                var src = previous && previous.pending ? media.src : media.currentSrc || media.src;
                return sources.findIndex(function(source) { return source.url === src; });
            },
            select: function(index, record) {
                var target = sources[index].url, position = media.currentTime, resume = !media.paused && !media.ended;
                if (target === (media.currentSrc || media.src)) return;
                var pending = { target: target };
                record.pending = pending;
                record.target = target;
                function cleanup() {
                    media.removeEventListener('loadedmetadata', loaded);
                    media.removeEventListener('error', failed);
                    view.clearTimeout(pending.timer);
                    if (record.pending === pending) record.pending = null;
                }
                pending.cancel = cleanup;
                function valid() {
                    return record.pending === pending && media.src === target && media.isConnected !== false;
                }
                function failed() {
                    var active = valid();
                    cleanup();
                    if (active) record.failed = true;
                }
                function loaded() {
                    if (!valid()) { cleanup(); return; }
                    try {
                        if (Number.isFinite(position) && Number.isFinite(media.duration) && media.duration > 0) {
                            media.currentTime = Math.max(0, Math.min(position, media.duration));
                        }
                        cleanup();
                        if (resume) {
                            var play = media.play();
                            if (play && play.catch) play.catch(function() {});
                        }
                    } catch (_) { cleanup(); record.failed = true; }
                }
                media.addEventListener('loadedmetadata', loaded);
                media.addEventListener('error', failed);
                pending.timer = view.setTimeout(failed, 15000);
                try { media.src = target; media.load(); }
                catch (_) { cleanup(); record.failed = true; throw _; }
            }
        };
    }
    if (previous && previous.pending && (media.src !== previous.pending.target || media.isConnected === false)) {
        previous.pending.cancel();
    }
    var adapter;
    // A broken optional player API must not break progress control or other adapters.
    try { adapter = youtubeAdapter(); } catch (_) {}
    if (!adapter) try { adapter = hlsAdapter(); } catch (_) {}
    if (!adapter) try { adapter = videojsAdapter(); } catch (_) {}
    if (!adapter) try { adapter = sourcesAdapter(); } catch (_) {}
    var currentHeight = height(media.videoHeight);
    if (!adapter) {
        // Retain an in-flight direct-source operation while duration is unknown during load().
        if (previous && previous.pending) return action === 'setQuality' ? { error: 'quality_busy' } :
            { supported: true, options: previous.options.map(function(option) { return { id: option.id, label: option.label }; }),
                selectedId: previous.requestedId, currentHeight: currentHeight, switching: true };
        var failed = !!previous && !!previous.failed && media.src === previous.target;
        if (previous && !failed) state.qualities.delete(media);
        return { supported: false, currentHeight: currentHeight, failed: failed };
    }
    var record = previous;
    if (!record || record.ref !== adapter.ref || record.signature !== adapter.signature || record.kind !== adapter.kind) {
        if (record && record.pending) record.pending.cancel();
        var prefix = state.prefix + '-q' + (++state.qualitySequence) + '-';
        var options = adapter.levels.map(function(level, index) { return { id: prefix + index, label: label(level), index: index }; });
        var counts = {};
        options.forEach(function(option) { counts[option.label] = (counts[option.label] || 0) + 1; });
        options.forEach(function(option) {
            if (counts[option.label] > 1) {
                var rate = bitrate(adapter.levels[option.index].bitrate);
                option.label += rate ? ' · ' + Math.round(rate / 1000) + ' kbps' : ' (' + (option.index + 1) + ')';
            }
        });
        options.sort(function(a, b) { return adapter.levels[b.index].height - adapter.levels[a.index].height; });
        if (adapter.auto) options.unshift({ id: prefix + 'auto', label: '自动', index: -1 });
        record = { ref: adapter.ref, kind: adapter.kind, signature: adapter.signature, options: options };
        state.qualities.set(media, record);
    }
    if (action === 'setQuality') {
        if (record.pending) return { error: 'quality_busy' };
        var chosen = record.options.find(function(option) { return option.id === qualityId; });
        if (!chosen) return { error: 'quality_changed' };
        record.failed = false;
        adapter.select(chosen.index, record);
        record.requestedId = chosen.id;
    }
    var selected = adapter.selected(record);
    var selectedOption = record.options.find(function(option) { return option.index === selected; });
    return { supported: true,
        options: record.options.map(function(option) { return { id: option.id, label: option.label }; }),
        selectedId: record.pending ? record.requestedId : selectedOption ? selectedOption.id : '',
        currentHeight: currentHeight, switching: !!record.pending, failed: !!record.failed };
})
