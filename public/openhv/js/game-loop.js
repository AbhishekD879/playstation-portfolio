// requestAnimationFrame bridge for OpenRA game loop
window.GameLoop = {
    running: false,
    hiddenTickDelayMs: 250,
    pendingHandle: null,
    pendingMode: null,
    debugTickCount: 0,
    forcedHiddenForTests: null,

    isHidden() {
        return this.forcedHiddenForTests !== null ? this.forcedHiddenForTests : document.hidden;
    },

    setForcedHiddenForTests(value) {
        this.forcedHiddenForTests = value;
    },

    start() {
        if (this.running) return;
        this.running = true;
        console.log('[GameLoop] Started');
        this._scheduleNextTick();
    },

    stop() {
        this.running = false;
        if (this.pendingHandle !== null) {
            if (this.pendingMode === 'timeout')
                clearTimeout(this.pendingHandle);
            else
                cancelAnimationFrame(this.pendingHandle);

            this.pendingHandle = null;
            this.pendingMode = null;
        }

        console.log('[GameLoop] Stopped');
    },

    _scheduleNextTick() {
        if (!this.running)
            return;

        if (this.isHidden()) {
            this.pendingMode = 'timeout';
            this.pendingHandle = setTimeout(() => {
                this.pendingHandle = null;
                this.pendingMode = null;
                GameLoop._tick();
            }, this.hiddenTickDelayMs);
        } else {
            const requestFrame = () => {
                this.pendingHandle = null;
                this.pendingMode = null;
                GameLoop._tick();
            };

            this.pendingMode = 'raf';
            this.pendingHandle = requestAnimationFrame(requestFrame);
        }
    },

    _tick() {
        if (!GameLoop.running) return;
        GameLoop.debugTickCount++;
        try {
            DotNet.invokeMethod('OpenRA.Platforms.Web', 'GameTick');
        } catch (e) {
            console.error('[GameLoop] Tick error:', e);
            GameLoop.running = false;
            return;
        }

        GameLoop._scheduleNextTick();
    }
};

document.addEventListener('visibilitychange', () => {
    if (!window.GameLoop.running)
        return;

    if (window.GameLoop.forcedHiddenForTests !== null)
        return;

    if (window.GameLoop.pendingHandle !== null) {
        if (window.GameLoop.pendingMode === 'timeout')
            clearTimeout(window.GameLoop.pendingHandle);
        else
            cancelAnimationFrame(window.GameLoop.pendingHandle);

        window.GameLoop.pendingHandle = null;
        window.GameLoop.pendingMode = null;
    }

    window.GameLoop._scheduleNextTick();
});
