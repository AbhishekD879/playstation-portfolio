// Input capture for OpenRA browser
window.InputInterop = (function () {
    let events = [];

    return {
        init(canvasId) {
            const canvas = document.getElementById(canvasId);
            if (!canvas) return;

            canvas.tabIndex = 0;
            canvas.focus();

            canvas.addEventListener('mousemove', e => {
                const rect = canvas.getBoundingClientRect();
                events.push({
                    type: 'mouse', action: 'move',
                    x: Math.round(e.clientX - rect.left),
                    y: Math.round(e.clientY - rect.top),
                    button: 0, deltaY: 0,
                    key: '', ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey,
                    repeat: false
                });
            });

            canvas.addEventListener('mousedown', e => {
                e.preventDefault();
                canvas.focus();
                const rect = canvas.getBoundingClientRect();
                events.push({
                    type: 'mouse', action: 'down',
                    x: Math.round(e.clientX - rect.left),
                    y: Math.round(e.clientY - rect.top),
                    button: e.button, deltaY: 0,
                    key: '', ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey,
                    repeat: false
                });
            });

            canvas.addEventListener('mouseup', e => {
                const rect = canvas.getBoundingClientRect();
                events.push({
                    type: 'mouse', action: 'up',
                    x: Math.round(e.clientX - rect.left),
                    y: Math.round(e.clientY - rect.top),
                    button: e.button, deltaY: 0,
                    key: '', ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey,
                    repeat: false
                });
            });

            canvas.addEventListener('wheel', e => {
                e.preventDefault();
                const rect = canvas.getBoundingClientRect();
                events.push({
                    type: 'mouse', action: 'scroll',
                    x: Math.round(e.clientX - rect.left),
                    y: Math.round(e.clientY - rect.top),
                    button: 0, deltaY: e.deltaY,
                    key: '', ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey,
                    repeat: false
                });
            }, { passive: false });

            canvas.addEventListener('contextmenu', e => e.preventDefault());

            canvas.addEventListener('keydown', e => {
                e.preventDefault();
                events.push({
                    type: 'key', action: 'down',
                    x: 0, y: 0, button: 0, deltaY: 0,
                    key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey,
                    repeat: e.repeat
                });
            });

            canvas.addEventListener('keyup', e => {
                e.preventDefault();
                events.push({
                    type: 'key', action: 'up',
                    x: 0, y: 0, button: 0, deltaY: 0,
                    key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey,
                    repeat: false
                });
            });

            console.log('[InputInterop] Initialized on canvas:', canvasId);
        },

        pollEvents() {
            const result = JSON.stringify(events);
            events = [];
            return result;
        }
    };
})();
