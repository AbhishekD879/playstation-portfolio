// Font rasterization via Canvas2D for OpenRA browser
window.FontInterop = (function () {
    let offCanvas = null;
    let offCtx = null;
    let lastPixelData = null;

    function ensureCanvas() {
        if (!offCanvas) {
            offCanvas = document.createElement('canvas');
            offCtx = offCanvas.getContext('2d', { willReadFrequently: true });
        }
    }

    return {
        renderGlyph(char, pixelSize) {
            ensureCanvas();

            const font = `${pixelSize}px monospace`;
            offCtx.font = font;
            const metrics = offCtx.measureText(char);

            const advance = metrics.width || pixelSize * 0.6;
            const bboxLeft = Math.ceil(metrics.actualBoundingBoxLeft || 0);
            const bboxRight = Math.ceil(metrics.actualBoundingBoxRight || advance);
            const bboxAscent = Math.ceil(metrics.actualBoundingBoxAscent || pixelSize * 0.8);
            const bboxDescent = Math.ceil(metrics.actualBoundingBoxDescent || pixelSize * 0.2);

            const glyphWidth = Math.max(0, bboxLeft + bboxRight);
            const glyphHeight = Math.max(0, bboxAscent + bboxDescent);
            if (glyphWidth <= 0 || glyphHeight <= 0) {
                lastPixelData = new Uint8Array(0);
                return [0, 0, advance, 0, 0];
            }

            const padding = 2;
            const canvasWidth = glyphWidth + padding * 2;
            const canvasHeight = glyphHeight + padding * 2;
            offCanvas.width = canvasWidth;
            offCanvas.height = canvasHeight;

            offCtx.font = font;
            offCtx.fillStyle = 'white';
            offCtx.textAlign = 'left';
            offCtx.textBaseline = 'alphabetic';
            offCtx.clearRect(0, 0, canvasWidth, canvasHeight);

            const originX = padding + bboxLeft;
            const originY = padding + bboxAscent;
            offCtx.fillText(char, originX, originY);

            const imageData = offCtx.getImageData(padding, padding, glyphWidth, glyphHeight);
            lastPixelData = new Uint8Array(imageData.data.buffer.slice(0));

            return [glyphWidth, glyphHeight, advance, -bboxLeft, bboxAscent];
        },

        getGlyphPixels() {
            return lastPixelData;
        }
    };
})();
