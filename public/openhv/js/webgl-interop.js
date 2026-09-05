// WebGL2 interop layer for OpenRA
// Uses handle-based approach to avoid passing WebGL objects across the JS/.NET boundary

window.WebGLInterop = (function () {
    let gl = null;
    let canvas = null;

    // Handle maps
    let nextHandle = 1;
    const buffers = new Map();
    const textures = new Map();
    const programs = new Map();
    const shaders = new Map();
    const framebuffers = new Map();
    const renderbuffers = new Map();
    const vertexArrays = new Map();
    const uniformLocations = new Map();
    let nextUniformHandle = 1;

    function getHandle(map, handle) {
        if (handle === 0) return null;
        return map.get(handle);
    }

    return {
        init(canvasId) {
            canvas = document.getElementById(canvasId);
            if (!canvas) {
                console.error('[WebGL] Canvas not found:', canvasId);
                return false;
            }
            gl = canvas.getContext('webgl2', {
                alpha: false,
                antialias: false,
                depth: true,
                stencil: false,
                premultipliedAlpha: true,
                preserveDrawingBuffer: false,
                powerPreference: 'default'
            });
            if (!gl) {
                console.error('[WebGL] WebGL2 not supported');
                return false;
            }
            console.log('[WebGL] Initialized:', gl.getParameter(gl.VERSION));
            return true;
        },

        // VAO
        createVertexArray() {
            const vao = gl.createVertexArray();
            const h = nextHandle++;
            vertexArrays.set(h, vao);
            return h;
        },
        bindVertexArray(handle) {
            gl.bindVertexArray(handle ? vertexArrays.get(handle) : null);
        },

        // Buffers
        createBuffer() {
            const buf = gl.createBuffer();
            const h = nextHandle++;
            buffers.set(h, buf);
            return h;
        },
        deleteBuffer(handle) {
            const buf = buffers.get(handle);
            if (buf) { gl.deleteBuffer(buf); buffers.delete(handle); }
        },
        bindBuffer(target, handle) {
            gl.bindBuffer(target, handle ? buffers.get(handle) : null);
        },
        bufferDataSize(target, size, usage) {
            gl.bufferData(target, size, usage);
        },
        bufferDataBytes(target, bytes, usage) {
            gl.bufferData(target, new Uint8Array(bytes), usage);
        },
        bufferSubDataBytes(target, offset, bytes) {
            gl.bufferSubData(target, offset, new Uint8Array(bytes));
        },

        // Textures
        createTexture() {
            const tex = gl.createTexture();
            const h = nextHandle++;
            textures.set(h, tex);
            return h;
        },
        deleteTexture(handle) {
            const tex = textures.get(handle);
            if (tex) { gl.deleteTexture(tex); textures.delete(handle); }
        },
        bindTexture(target, handle) {
            gl.bindTexture(target, handle ? textures.get(handle) : null);
        },
        activeTexture(unit) {
            gl.activeTexture(unit);
        },
        texParameteri(target, pname, param) {
            gl.texParameteri(target, pname, param);
        },
        texImage2DBytes(target, level, internalFormat, width, height, border, format, type, bytes) {
            gl.texImage2D(target, level, internalFormat, width, height, border, format, type, new Uint8Array(bytes));
        },
        texImage2DEmpty(target, level, internalFormat, width, height, border, format, type) {
            gl.texImage2D(target, level, internalFormat, width, height, border, format, type, null);
        },
        texImage2DFloat(target, level, internalFormat, width, height, border, format, type, data) {
            gl.texImage2D(target, level, internalFormat, width, height, border, format, type, new Float32Array(data));
        },
        copyTexSubImage2D(target, level, xoff, yoff, x, y, w, h) {
            gl.copyTexSubImage2D(target, level, xoff, yoff, x, y, w, h);
        },

        // Shaders
        createShader(type) {
            const s = gl.createShader(type);
            const h = nextHandle++;
            shaders.set(h, s);
            return h;
        },
        deleteShader(handle) {
            const s = shaders.get(handle);
            if (s) { gl.deleteShader(s); shaders.delete(handle); }
        },
        shaderSource(handle, source) {
            gl.shaderSource(shaders.get(handle), source);
        },
        compileShader(handle) {
            const s = shaders.get(handle);
            gl.compileShader(s);
            return gl.getShaderParameter(s, gl.COMPILE_STATUS);
        },
        getShaderInfoLog(handle) {
            return gl.getShaderInfoLog(shaders.get(handle));
        },

        // Programs
        createProgram() {
            const p = gl.createProgram();
            const h = nextHandle++;
            programs.set(h, p);
            return h;
        },
        deleteProgram(handle) {
            const p = programs.get(handle);
            if (p) { gl.deleteProgram(p); programs.delete(handle); }
        },
        attachShader(progHandle, shaderHandle) {
            gl.attachShader(programs.get(progHandle), shaders.get(shaderHandle));
        },
        linkProgram(handle) {
            const p = programs.get(handle);
            gl.linkProgram(p);
            return gl.getProgramParameter(p, gl.LINK_STATUS);
        },
        getProgramInfoLog(handle) {
            return gl.getProgramInfoLog(programs.get(handle));
        },
        useProgram(handle) {
            gl.useProgram(handle ? programs.get(handle) : null);
        },
        bindAttribLocation(progHandle, index, name) {
            gl.bindAttribLocation(programs.get(progHandle), index, name);
        },

        // Uniforms
        getActiveUniformCount(progHandle) {
            return gl.getProgramParameter(programs.get(progHandle), gl.ACTIVE_UNIFORMS);
        },
        getActiveUniformName(progHandle, index) {
            const info = gl.getActiveUniform(programs.get(progHandle), index);
            return info ? info.name : "";
        },
        getActiveUniformType(progHandle, index) {
            const info = gl.getActiveUniform(programs.get(progHandle), index);
            return info ? info.type : 0;
        },
        getUniformLocation(progHandle, name) {
            const p = programs.get(progHandle);
            const loc = gl.getUniformLocation(p, name);
            if (loc === null) return -1;
            const h = nextUniformHandle++;
            uniformLocations.set(h, loc);
            return h;
        },

        uniform1i(locHandle, value) {
            const loc = uniformLocations.get(locHandle);
            if (loc !== undefined) gl.uniform1i(loc, value);
        },
        uniform1f(locHandle, value) {
            const loc = uniformLocations.get(locHandle);
            if (loc !== undefined) gl.uniform1f(loc, value);
        },
        uniform2f(locHandle, x, y) {
            const loc = uniformLocations.get(locHandle);
            if (loc !== undefined) gl.uniform2f(loc, x, y);
        },
        uniform3f(locHandle, x, y, z) {
            const loc = uniformLocations.get(locHandle);
            if (loc !== undefined) gl.uniform3f(loc, x, y, z);
        },
        uniform4f(locHandle, x, y, z, w) {
            const loc = uniformLocations.get(locHandle);
            if (loc !== undefined) gl.uniform4f(loc, x, y, z, w);
        },
        uniform1fv(locHandle, values) {
            const loc = uniformLocations.get(locHandle);
            if (loc !== undefined) gl.uniform1fv(loc, new Float32Array(values));
        },
        uniformMatrix4fv(locHandle, values) {
            const loc = uniformLocations.get(locHandle);
            if (loc !== undefined) gl.uniformMatrix4fv(loc, false, new Float32Array(values));
        },

        // Vertex attributes
        enableVertexAttribArray(index) {
            gl.enableVertexAttribArray(index);
        },
        vertexAttribPointer(index, size, type, normalized, stride, offset) {
            gl.vertexAttribPointer(index, size, type, normalized, stride, offset);
        },
        vertexAttribIPointer(index, size, type, stride, offset) {
            gl.vertexAttribIPointer(index, size, type, stride, offset);
        },

        // Framebuffers
        createFramebuffer() {
            const fb = gl.createFramebuffer();
            const h = nextHandle++;
            framebuffers.set(h, fb);
            return h;
        },
        deleteFramebuffer(handle) {
            const fb = framebuffers.get(handle);
            if (fb) { gl.deleteFramebuffer(fb); framebuffers.delete(handle); }
        },
        bindFramebuffer(target, handle) {
            gl.bindFramebuffer(target, handle ? framebuffers.get(handle) : null);
        },
        framebufferTexture2D(target, attachment, texTarget, texHandle, level) {
            gl.framebufferTexture2D(target, attachment, texTarget, textures.get(texHandle), level);
        },

        // Renderbuffers
        createRenderbuffer() {
            const rb = gl.createRenderbuffer();
            const h = nextHandle++;
            renderbuffers.set(h, rb);
            return h;
        },
        deleteRenderbuffer(handle) {
            const rb = renderbuffers.get(handle);
            if (rb) { gl.deleteRenderbuffer(rb); renderbuffers.delete(handle); }
        },
        bindRenderbuffer(target, handle) {
            gl.bindRenderbuffer(target, handle ? renderbuffers.get(handle) : null);
        },
        renderbufferStorage(target, format, width, height) {
            gl.renderbufferStorage(target, format, width, height);
        },
        framebufferRenderbuffer(target, attachment, rbTarget, rbHandle) {
            gl.framebufferRenderbuffer(target, attachment, rbTarget, renderbuffers.get(rbHandle));
        },

        // State
        enable(cap) { gl.enable(cap); },
        disable(cap) { gl.disable(cap); },
        blendFunc(sfactor, dfactor) { gl.blendFunc(sfactor, dfactor); },
        blendEquation(mode) { gl.blendEquation(mode); },
        depthFunc(func) { gl.depthFunc(func); },
        scissor(x, y, w, h) { gl.scissor(x, y, w, h); },
        viewport(x, y, w, h) { gl.viewport(x, y, w, h); },
        getViewport() { return Array.from(gl.getParameter(gl.VIEWPORT)); },
        clearColor(r, g, b, a) { gl.clearColor(r, g, b, a); },
        clear(mask) { gl.clear(mask); },

        // Drawing
        drawArrays(mode, first, count) { gl.drawArrays(mode, first, count); },
        drawElements(mode, count, type, offset) { gl.drawElements(mode, count, type, offset); },

        // Utility
        loadFile(url) {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', url, false);
            xhr.send();
            if (xhr.status === 200) return xhr.responseText;
            return null;
        },
        loadFileBytes(url) {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', url, false);
            xhr.overrideMimeType('text/plain; charset=x-user-defined');
            xhr.send();
            if (xhr.status === 200) {
                const text = xhr.responseText;
                const bytes = new Uint8Array(text.length);
                for (let i = 0; i < text.length; i++)
                    bytes[i] = text.charCodeAt(i) & 0xff;
                return Array.from(bytes);
            }
            return null;
        },
        loadFileBase64(url) {
            const status = document.getElementById('loading-status');
            if (status) status.textContent = 'Downloading: ' + url.split('/').pop();

            const xhr = new XMLHttpRequest();
            xhr.open('GET', url, false);
            xhr.overrideMimeType('text/plain; charset=x-user-defined');
            xhr.send();
            if (xhr.status === 200) {
                const text = xhr.responseText;
                // Convert binary string to base64 in chunks to avoid stack overflow
                const chunkSize = 8192;
                let binary = '';
                for (let i = 0; i < text.length; i += chunkSize) {
                    const chunk = text.substring(i, Math.min(i + chunkSize, text.length));
                    for (let j = 0; j < chunk.length; j++)
                        binary += String.fromCharCode(chunk.charCodeAt(j) & 0xff);
                }
                return btoa(binary);
            }
            return null;
        }
    };
})();
