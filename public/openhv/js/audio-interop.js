window.AudioInterop = (function () {
    let initialized = false;
    let unlocked = false;
    let masterVolume = 1;
    let nextHandle = 1;
    const sources = new Map();
    const sounds = new Map();
    const pending = [];

    function clamp(value) {
        return Math.max(0, Math.min(1, value));
    }

    function tryUnlock() {
        unlocked = true;
        while (pending.length > 0) {
            const play = pending.shift();
            play();
        }
    }

    function ensureInit() {
        if (initialized)
            return;

        initialized = true;
        window.addEventListener('pointerdown', tryUnlock, { passive: true });
        window.addEventListener('keydown', tryUnlock, { passive: true });
        window.addEventListener('touchstart', tryUnlock, { passive: true });
    }

    function currentVolume(entry) {
        return clamp(entry.baseVolume * (entry.excludeFromEffects ? 1 : masterVolume));
    }

    function markComplete(handle) {
        const entry = sounds.get(handle);
        if (entry)
            entry.complete = true;
    }

    function playEntry(entry) {
        const promise = entry.audio.play();
        if (promise && typeof promise.catch === 'function') {
            promise.catch(() => {
                if (!unlocked)
                    pending.push(() => playEntry(entry));
            });
        }
    }

    return {
        init() {
            ensureInit();
        },

        createSource(bytes) {
            ensureInit();
            const blob = new Blob([new Uint8Array(bytes)], { type: 'audio/wav' });
            const url = URL.createObjectURL(blob);
            const handle = nextHandle++;
            sources.set(handle, { url });
            return handle;
        },

        deleteSource(handle) {
            const source = sources.get(handle);
            if (!source)
                return;

            URL.revokeObjectURL(source.url);
            sources.delete(handle);
        },

        playSource(sourceHandle, loop, volume) {
            ensureInit();
            const source = sources.get(sourceHandle);
            if (!source)
                return 0;

            const audio = new Audio(source.url);
            audio.preload = 'auto';
            audio.loop = !!loop;

            const handle = nextHandle++;
            const entry = {
                audio,
                baseVolume: clamp(volume),
                complete: false,
                excludeFromEffects: false
            };

            audio.volume = currentVolume(entry);
            audio.addEventListener('ended', () => markComplete(handle));
            sounds.set(handle, entry);

            if (unlocked)
                playEntry(entry);
            else
                pending.push(() => playEntry(entry));

            return handle;
        },

        pauseSound(handle, paused) {
            const entry = sounds.get(handle);
            if (!entry)
                return;

            if (paused)
                entry.audio.pause();
            else if (unlocked)
                playEntry(entry);
            else
                pending.push(() => playEntry(entry));
        },

        stopSound(handle) {
            const entry = sounds.get(handle);
            if (!entry)
                return;

            entry.audio.pause();
            entry.audio.currentTime = 0;
            entry.complete = true;
            sounds.delete(handle);
        },

        setAllSoundsPaused(paused) {
            for (const entry of sounds.values()) {
                if (paused)
                    entry.audio.pause();
                else if (unlocked)
                    playEntry(entry);
            }
        },

        stopAllSounds() {
            for (const [handle, entry] of sounds.entries()) {
                entry.audio.pause();
                entry.audio.currentTime = 0;
                entry.complete = true;
                sounds.delete(handle);
            }
        },

        setMasterVolume(volume) {
            masterVolume = clamp(volume);
            for (const entry of sounds.values())
                entry.audio.volume = currentVolume(entry);
        },

        setEffectsVolume(volume, musicHandle, videoHandle) {
            masterVolume = clamp(volume);
            for (const [handle, entry] of sounds.entries()) {
                entry.excludeFromEffects = handle === musicHandle || handle === videoHandle;
                entry.audio.volume = currentVolume(entry);
            }
        },

        setSoundLooping(handle, looping) {
            const entry = sounds.get(handle);
            if (entry)
                entry.audio.loop = !!looping;
        },

        setSoundPosition(handle, x, y, z) {
        },

        setSoundVolume(handle, volume) {
            const entry = sounds.get(handle);
            if (!entry)
                return;

            entry.baseVolume = clamp(volume);
            entry.audio.volume = currentVolume(entry);
        },

        getSoundVolume(handle) {
            const entry = sounds.get(handle);
            return entry ? entry.baseVolume : 0;
        },

        getSoundSeekPosition(handle) {
            const entry = sounds.get(handle);
            return entry ? entry.audio.currentTime || 0 : 0;
        },

        isSoundComplete(handle) {
            const entry = sounds.get(handle);
            return !entry || entry.complete;
        }
    };
})();
