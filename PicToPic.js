let sourceImage = null;
let targetImage = null;
let sourceCanvas = document.createElement('canvas');
let targetCanvas = document.createElement('canvas');
let sourceFile = null;
let targetFile = null;
let resultBlob = null;
let isConverting = false;
let animationId = null;
let isAnimating = false;
let gl = null;
let shaderProgram = null;
let fromPosBuffer = null;
let toPosBuffer = null;
let colorBuffer = null;
let pixelCount = 0;
let mappingData = null;
let animStartTime = 0;
let currentEasingFn = null;
let currentDuration = 5;
let isRecording = false;
let animFinished = false;

const easingFunctions = {
    linear: t => t,
    easeInQuad: t => t * t,
    easeOutQuad: t => t * (2 - t),
    easeInOutQuad: t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
    easeOutBack: t => {
        const c1 = 1.70158;
        const c3 = c1 + 1;
        return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    },
    easeOutElastic: t => {
        const c4 = (2 * Math.PI) / 3;
        return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
    },
    easeOutBounce: t => {
        const n1 = 7.5625;
        const d1 = 2.75;
        if (t < 1 / d1) {
            return n1 * t * t;
        } else if (t < 2 / d1) {
            return n1 * (t -= 1.5 / d1) * t + 0.75;
        } else if (t < 2.5 / d1) {
            return n1 * (t -= 2.25 / d1) * t + 0.9375;
        } else {
            return n1 * (t -= 2.625 / d1) * t + 0.984375;
        }
    }
};

// ==================== WebGL 初始化 ====================
function initWebGL(canvas) {
    gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, antialias: false });
    if (!gl) {
        gl = canvas.getContext('experimental-webgl', { preserveDrawingBuffer: true, antialias: false });
    }
    if (!gl) {
        console.error('WebGL not supported');
        return false;
    }

    const vsSource = `
        attribute vec2 a_fromPos;
        attribute vec2 a_toPos;
        attribute vec3 a_color;
        uniform float u_t;
        uniform vec2 u_resolution;
        uniform float u_pointSize;
        varying vec3 v_color;
        void main() {
            vec2 pos = mix(a_fromPos, a_toPos, u_t);
            vec2 clipPos = (pos / u_resolution) * 2.0 - 1.0;
            clipPos.y = -clipPos.y;
            gl_Position = vec4(clipPos, 0.0, 1.0);
            gl_PointSize = u_pointSize;
            v_color = a_color / 255.0;
        }
    `;

    const fsSource = `
        precision mediump float;
        varying vec3 v_color;
        void main() {
            gl_FragColor = vec4(v_color, 1.0);
        }
    `;

    function compileShader(type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Shader compile error:', gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    }

    const vertexShader = compileShader(gl.VERTEX_SHADER, vsSource);
    const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fsSource);

    if (!vertexShader || !fragmentShader) return false;

    shaderProgram = gl.createProgram();
    gl.attachShader(shaderProgram, vertexShader);
    gl.attachShader(shaderProgram, fragmentShader);
    gl.linkProgram(shaderProgram);

    if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
        console.error('Program link error:', gl.getProgramInfoLog(shaderProgram));
        return false;
    }

    gl.useProgram(shaderProgram);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);

    return true;
}

function uploadPixelData(mapping, width, height) {
    if (!gl || !shaderProgram) return;

    pixelCount = mapping.length;
    const fromPositions = new Float32Array(pixelCount * 2);
    const toPositions = new Float32Array(pixelCount * 2);
    const colors = new Float32Array(pixelCount * 3);

    for (let i = 0; i < mapping.length; i++) {
        const m = mapping[i];
        fromPositions[i * 2] = m.fromX + 0.5;
        fromPositions[i * 2 + 1] = m.fromY + 0.5;
        toPositions[i * 2] = m.toX + 0.5;
        toPositions[i * 2 + 1] = m.toY + 0.5;
        colors[i * 3] = m.color[0];
        colors[i * 3 + 1] = m.color[1];
        colors[i * 3 + 2] = m.color[2];
    }

    if (fromPosBuffer) gl.deleteBuffer(fromPosBuffer);
    fromPosBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, fromPosBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, fromPositions, gl.STATIC_DRAW);

    const aFromPos = gl.getAttribLocation(shaderProgram, 'a_fromPos');
    gl.enableVertexAttribArray(aFromPos);
    gl.vertexAttribPointer(aFromPos, 2, gl.FLOAT, false, 0, 0);

    if (toPosBuffer) gl.deleteBuffer(toPosBuffer);
    toPosBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, toPosBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, toPositions, gl.STATIC_DRAW);

    const aToPos = gl.getAttribLocation(shaderProgram, 'a_toPos');
    gl.enableVertexAttribArray(aToPos);
    gl.vertexAttribPointer(aToPos, 2, gl.FLOAT, false, 0, 0);

    if (colorBuffer) gl.deleteBuffer(colorBuffer);
    colorBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);

    const aColor = gl.getAttribLocation(shaderProgram, 'a_color');
    gl.enableVertexAttribArray(aColor);
    gl.vertexAttribPointer(aColor, 3, gl.FLOAT, false, 0, 0);

    const uResolution = gl.getUniformLocation(shaderProgram, 'u_resolution');
    gl.uniform2f(uResolution, width, height);
}

function updatePointSize(width, height, canvasWidth, canvasHeight) {
    if (!gl || !shaderProgram) return;

    // 修复：计算每个逻辑像素在 canvas 上占多少屏幕像素
    // 使用 ceil 确保点足够大以覆盖整个区域，消除缝隙
    const scaleX = canvasWidth / width;
    const scaleY = canvasHeight / height;
    const pixelScale = Math.min(scaleX, scaleY);

    // 关键修复：使用 Math.ceil 向上取整，确保点覆盖整个像素区域
    // 同时添加一个小的偏移量来补偿浮点精度问题
    const pointSize = Math.max(Math.ceil(pixelScale + 0.5), 1.0);

    const uPointSize = gl.getUniformLocation(shaderProgram, 'u_pointSize');
    gl.uniform1f(uPointSize, pointSize);
}

function renderWebGLFrame(t) {
    if (!gl || pixelCount === 0 || !shaderProgram) return;
    const easedT = currentEasingFn ? currentEasingFn(t) : t;
    const uT = gl.getUniformLocation(shaderProgram, 'u_t');
    gl.uniform1f(uT, easedT);
    gl.clearColor(1.0, 1.0, 1.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.POINTS, 0, pixelCount);
}

function startPreviewAnimation() {
    if (isAnimating) return;
    isAnimating = true;
    animFinished = false;
    animStartTime = performance.now();
    const duration = currentDuration * 1000;
    const holdTime = 500;
    const btn = document.getElementById('convertBtn');
    if (btn) btn.style.display = 'none';

    function animate() {
        if (!isAnimating) return;
        const elapsed = performance.now() - animStartTime;
        let t;
        if (elapsed < holdTime) {
            t = 0;
        } else if (elapsed >= holdTime + duration) {
            t = 1;
            isAnimating = false;
            animFinished = true;
            renderWebGLFrame(1);
            if (!isRecording && !isConverting && btn) btn.style.display = '';
            return;
        } else {
            t = (elapsed - holdTime) / duration;
        }
        renderWebGLFrame(t);
        animationId = requestAnimationFrame(animate);
    }
    animationId = requestAnimationFrame(animate);
}

function stopPreviewAnimation() {
    isAnimating = false;
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }
    const indicator = document.getElementById('liveIndicator');
    if (indicator) indicator.style.display = 'none';
    const btn = document.getElementById('convertBtn');
    if (!isRecording && !isConverting && btn) btn.style.display = '';
}

document.addEventListener('DOMContentLoaded', function() {
    const previewCanvas = document.getElementById('previewCanvas');
    if (previewCanvas) {
        previewCanvas.addEventListener('click', function() {
            if (animFinished && mappingData) replayAnimation();
        });
        previewCanvas.style.cursor = 'pointer';
    }
});

// ==================== 原有功能 ====================

document.getElementById('maxSizeInput').addEventListener('input', function() {
    const size = parseInt(this.value) || 256;
    document.getElementById('pixelCountInfo').textContent = 
        `预计最大像素数: ${(size * size).toLocaleString()}`;
    autoReprocessImages();
});

let easingDebounceTimer = null;
document.getElementById('easingSelect').addEventListener('change', function() {
    if (mappingData) {
        currentEasingFn = easingFunctions[this.value] || easingFunctions.easeInOutQuad;
        replayAnimation();
    }
});

let algorithmDebounceTimer = null;
document.getElementById('algorithmSelect').addEventListener('change', function() {
    if (algorithmDebounceTimer) clearTimeout(algorithmDebounceTimer);
    algorithmDebounceTimer = setTimeout(() => {
        if (sourceImage && targetImage && !isConverting && !isRecording) {
            startConversion(true);
        }
    }, 300);
});

document.getElementById('durationInput').addEventListener('input', function() {
    if (easingDebounceTimer) clearTimeout(easingDebounceTimer);
    easingDebounceTimer = setTimeout(() => {
        if (mappingData) {
            currentDuration = parseFloat(this.value) || 5;
            replayAnimation();
        }
    }, 300);
});

function autoReprocessImages() {
    if (sourceFile) handleFile(sourceFile, 'source');
    if (targetFile) handleFile(targetFile, 'target');
}

document.getElementById('sourceInput').addEventListener('change', function(e) {
    sourceFile = e.target.files[0];
    handleFile(sourceFile, 'source');
});

document.getElementById('targetInput').addEventListener('change', function(e) {
    targetFile = e.target.files[0];
    handleFile(targetFile, 'target');
});

function handleFile(file, type) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            const maxSize = parseInt(document.getElementById('maxSizeInput').value) || 256;
            if (type === 'source') {
                sourceImage = resizeImage(img, sourceCanvas, maxSize);
                updatePreview('sourcePreview', sourceCanvas, img);
            } else {
                targetImage = resizeImage(img, targetCanvas, maxSize);
                updatePreview('targetPreview', targetCanvas, img);
            }
            if (sourceImage && targetImage && !isConverting && !isRecording) {
                setTimeout(() => startConversion(true), 100);
            }
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function resizeImage(img, canvas, maxSize) {
    let width = img.width;
    let height = img.height;
    if (width > maxSize || height > maxSize) {
        if (width > height) {
            height = Math.round(height * (maxSize / width));
            width = maxSize;
        } else {
            width = Math.round(width * (maxSize / height));
            height = maxSize;
        }
    }
    width = Math.max(1, width);
    height = Math.max(1, height);
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height);
}

function updatePreview(previewId, canvas, originalImg) {
    const preview = document.getElementById(previewId);
    const dataUrl = canvas.toDataURL();
    preview.innerHTML = `
        <img src="${dataUrl}">
        <div class="dimensions">${canvas.width}×${canvas.height}</div>
    `;
}

function getPixel(data, x, y, width) {
    const idx = (y * width + x) * 4;
    return [data[idx], data[idx+1], data[idx+2]];
}

// ==================== 优化的像素匹配算法 ====================

// 算法2: 亮度排序映射
function brightnessSortMapping(sourcePixels, targetPixels, sw, sh, tw, th) {
    const mapping = [];
    const sortedSource = [...sourcePixels].sort((a, b) => a.brightness - b.brightness);
    const sortedTarget = [...targetPixels].sort((a, b) => a.brightness - b.brightness);
    const count = Math.min(sortedSource.length, sortedTarget.length);
    for (let i = 0; i < count; i++) {
        mapping.push({
            fromX: sortedSource[i].origX,
            fromY: sortedSource[i].origY,
            toX: sortedTarget[i].x,
            toY: sortedTarget[i].y,
            color: sortedSource[i].color
        });
    }
    for (let i = count; i < targetPixels.length; i++) {
        const src = sortedSource[i % sortedSource.length];
        mapping.push({
            fromX: src.origX,
            fromY: src.origY,
            toX: sortedTarget[i].x,
            toY: sortedTarget[i].y,
            color: src.color
        });
    }
    return mapping;
}

// 算法4: 贪婪最近邻
function greedyNNMapping(sourcePixels, targetPixels, sw, sh, tw, th) {
    const mapping = [];
    const used = new Uint8Array(sourcePixels.length);

    for (let ti = 0; ti < targetPixels.length; ti++) {
        const tp = targetPixels[ti];
        let bestIdx = -1;
        let bestScore = Infinity;

        for (let si = 0; si < sourcePixels.length; si++) {
            if (used[si]) continue;
            const sp = sourcePixels[si];
            const dx = sp.origX - tp.x;
            const dy = sp.origY - tp.y;
            const spatialDist = dx * dx + dy * dy;

            const rDiff = sp.color[0] - tp.color[0];
            const gDiff = sp.color[1] - tp.color[1];
            const bDiff = sp.color[2] - tp.color[2];
            const colorDist = (rDiff * rDiff + gDiff * gDiff + bDiff * bDiff) * 0.1;

            const score = spatialDist + colorDist;
            if (score < bestScore) {
                bestScore = score;
                bestIdx = si;
            }
        }

        if (bestIdx !== -1) {
            used[bestIdx] = 1;
            const sp = sourcePixels[bestIdx];
            mapping.push({
                fromX: sp.origX,
                fromY: sp.origY,
                toX: tp.x,
                toY: tp.y,
                color: sp.color
            });
        }
    }

    for (let ti = mapping.length; ti < targetPixels.length; ti++) {
        const tp = targetPixels[ti];
        const sp = sourcePixels[ti % sourcePixels.length];
        mapping.push({
            fromX: sp.origX,
            fromY: sp.origY,
            toX: tp.x,
            toY: tp.y,
            color: sp.color
        });
    }

    return mapping;
}

// 算法3: 最近颜色匹配
function nearestColorMapping(sourcePixels, targetPixels, sw, sh, tw, th) {
    const mapping = [];
    const used = new Uint8Array(sourcePixels.length);

    for (let ti = 0; ti < targetPixels.length; ti++) {
        const tp = targetPixels[ti];
        let bestIdx = -1;
        let bestDist = Infinity;

        for (let si = 0; si < sourcePixels.length; si++) {
            if (used[si]) continue;
            const sp = sourcePixels[si];

            const rDiff = sp.color[0] - tp.color[0];
            const gDiff = sp.color[1] - tp.color[1];
            const bDiff = sp.color[2] - tp.color[2];
            const colorDist = rDiff * rDiff + gDiff * gDiff + bDiff * bDiff;

            if (colorDist < bestDist) {
                bestDist = colorDist;
                bestIdx = si;
            }
        }

        if (bestIdx !== -1) {
            used[bestIdx] = 1;
            const sp = sourcePixels[bestIdx];
            mapping.push({
                fromX: sp.origX,
                fromY: sp.origY,
                toX: tp.x,
                toY: tp.y,
                color: sp.color
            });
        }
    }

    for (let ti = mapping.length; ti < targetPixels.length; ti++) {
        const tp = targetPixels[ti];
        const sp = sourcePixels[ti % sourcePixels.length];
        mapping.push({
            fromX: sp.origX,
            fromY: sp.origY,
            toX: tp.x,
            toY: tp.y,
            color: sp.color
        });
    }

    return mapping;
}

// 算法7: Voronoi区域匹配
function voronoiMapping(sourcePixels, targetPixels, sw, sh, tw, th) {
    const NUM_SITES = Math.min(16, Math.floor(Math.sqrt(sourcePixels.length)));

    function pickSites(pixels, count, w, h) {
        const sites = [];
        const step = Math.floor(pixels.length / count);
        for (let i = 0; i < count; i++) {
            const idx = Math.min(i * step + Math.floor(Math.random() * step), pixels.length - 1);
            sites.push({
                x: pixels[idx].origX !== undefined ? pixels[idx].origX : pixels[idx].x,
                y: pixels[idx].origY !== undefined ? pixels[idx].origY : pixels[idx].y,
                color: pixels[idx].color,
                idx: i
            });
        }
        return sites;
    }

    const sourceSites = pickSites(sourcePixels, NUM_SITES, sw, sh);
    const targetSites = pickSites(targetPixels, NUM_SITES, tw, th);

    function assignRegions(pixels, sites, w, h, isSource) {
        const regions = new Array(sites.length).fill(null).map(() => []);
        for (const p of pixels) {
            const px = isSource ? p.origX : p.x;
            const py = isSource ? p.origY : p.y;
            let bestSite = 0;
            let bestDist = Infinity;
            for (let s = 0; s < sites.length; s++) {
                const dx = px - sites[s].x;
                const dy = py - sites[s].y;
                const dist = dx * dx + dy * dy;
                if (dist < bestDist) {
                    bestDist = dist;
                    bestSite = s;
                }
            }
            regions[bestSite].push(p);
        }
        return regions;
    }

    const sourceRegions = assignRegions(sourcePixels, sourceSites, sw, sh, true);
    const targetRegions = assignRegions(targetPixels, targetSites, tw, th, false);

    const mapping = [];
    const used = new Uint8Array(sourcePixels.length);

    for (let r = 0; r < NUM_SITES; r++) {
        const sReg = sourceRegions[r];
        const tReg = targetRegions[r];

        for (let ti = 0; ti < tReg.length; ti++) {
            const tp = tReg[ti];
            let bestIdx = -1;
            let bestScore = Infinity;

            for (const sp of sReg) {
                if (used[sp.idx]) continue;
                const dx = sp.origX - tp.x;
                const dy = sp.origY - tp.y;
                const spatial = dx * dx + dy * dy;
                const rDiff = sp.color[0] - tp.color[0];
                const gDiff = sp.color[1] - tp.color[1];
                const bDiff = sp.color[2] - tp.color[2];
                const color = (rDiff*rDiff + gDiff*gDiff + bDiff*bDiff) * 0.1;
                const score = spatial + color;
                if (score < bestScore) {
                    bestScore = score;
                    bestIdx = sp.idx;
                }
            }

            if (bestIdx !== -1) {
                used[bestIdx] = 1;
                const sp = sourcePixels[bestIdx];
                mapping.push({
                    fromX: sp.origX,
                    fromY: sp.origY,
                    toX: tp.x,
                    toY: tp.y,
                    color: sp.color
                });
            }
        }
    }

    const unmatchedTargets = [];
    for (let r = 0; r < NUM_SITES; r++) {
        for (const tp of targetRegions[r]) {
            const alreadyMapped = mapping.some(m => m.toX === tp.x && m.toY === tp.y);
            if (!alreadyMapped) unmatchedTargets.push(tp);
        }
    }

    for (const tp of unmatchedTargets) {
        let bestIdx = -1;
        let bestScore = Infinity;
        for (let si = 0; si < sourcePixels.length; si++) {
            if (used[si]) continue;
            const sp = sourcePixels[si];
            const dx = sp.origX - tp.x;
            const dy = sp.origY - tp.y;
            const spatial = dx * dx + dy * dy;
            const rDiff = sp.color[0] - tp.color[0];
            const gDiff = sp.color[1] - tp.color[1];
            const bDiff = sp.color[2] - tp.color[2];
            const color = (rDiff*rDiff + gDiff*gDiff + bDiff*bDiff) * 0.05;
            const score = spatial + color;
            if (score < bestScore) {
                bestScore = score;
                bestIdx = si;
            }
        }
        if (bestIdx !== -1) {
            used[bestIdx] = 1;
            const sp = sourcePixels[bestIdx];
            mapping.push({
                fromX: sp.origX,
                fromY: sp.origY,
                toX: tp.x,
                toY: tp.y,
                color: sp.color
            });
        }
    }

    return mapping;
}

// 算法调度器
function runMappingAlgorithm(algorithm, sourcePixels, targetPixels, sw, sh, tw, th) {
    switch (algorithm) {
        case 'brightnessSort':
            return brightnessSortMapping(sourcePixels, targetPixels, sw, sh, tw, th);
        case 'greedyNN':
            return greedyNNMapping(sourcePixels, targetPixels, sw, sh, tw, th);
        case 'nearestColor':
            return nearestColorMapping(sourcePixels, targetPixels, sw, sh, tw, th);
        case 'voronoi':
            return voronoiMapping(sourcePixels, targetPixels, sw, sh, tw, th);
        case 'kdTreeColor':
        default:
            return optimizeMapping(sourcePixels, targetPixels, sw, sh, tw, th);
    }
}

function optimizeMapping(sourcePixels, targetPixels, sourceWidth, sourceHeight, targetWidth, targetHeight) {
    const mapping = [];
    const used = new Uint8Array(sourcePixels.length);

    class FlatKDTree {
        constructor(points, depth = 0) {
            this.points = points;
            this.depth = depth;
            this.axis = depth % 2;
            this.median = -1;
            this.left = null;
            this.right = null;
            this.built = false;
        }

        build() {
            if (this.points.length <= 8) {
                this.built = true;
                return;
            }

            this.points.sort((a, b) => {
                return this.axis === 0 ? a.origX - b.origX : a.origY - b.origY;
            });

            this.median = Math.floor(this.points.length / 2);
            const leftPoints = this.points.slice(0, this.median);
            const rightPoints = this.points.slice(this.median + 1);

            if (leftPoints.length > 0) {
                this.left = new FlatKDTree(leftPoints, this.depth + 1);
                this.left.build();
            }
            if (rightPoints.length > 0) {
                this.right = new FlatKDTree(rightPoints, this.depth + 1);
                this.right.build();
            }
            this.built = true;
        }

        nearest(targetX, targetY, best, used) {
            if (!this.built) return best;

            if (this.points.length <= 8 || this.median === -1) {
                for (let i = 0; i < this.points.length; i++) {
                    const p = this.points[i];
                    if (used[p.idx]) continue;

                    const dx = p.origX - targetX;
                    const dy = p.origY - targetY;
                    const dist = dx * dx + dy * dy;

                    if (dist < best.dist) {
                        best.dist = dist;
                        best.idx = p.idx;
                        best.point = p;
                    }
                }
                return best;
            }

            const medianPoint = this.points[this.median];
            const targetVal = this.axis === 0 ? targetX : targetY;
            const medianVal = this.axis === 0 ? medianPoint.origX : medianPoint.origY;

            let first = this.left;
            let second = this.right;

            if (targetVal > medianVal) {
                first = this.right;
                second = this.left;
            }

            if (first) {
                best = first.nearest(targetX, targetY, best, used);
            }

            const diff = targetVal - medianVal;
            if (diff * diff < best.dist && second) {
                best = second.nearest(targetX, targetY, best, used);
            }

            if (!used[medianPoint.idx]) {
                const dx = medianPoint.origX - targetX;
                const dy = medianPoint.origY - targetY;
                const dist = dx * dx + dy * dy;
                if (dist < best.dist) {
                    best.dist = dist;
                    best.idx = medianPoint.idx;
                    best.point = medianPoint;
                }
            }

            return best;
        }
    }

    const COLOR_BUCKET_BITS = 5;
    const COLOR_BUCKET_SIZE = 256 / (1 << COLOR_BUCKET_BITS);

    function getColorBucket(r, g, b) {
        return ((r >> COLOR_BUCKET_BITS) << 10) | 
               ((g >> COLOR_BUCKET_BITS) << 5) | 
               (b >> COLOR_BUCKET_BITS);
    }

    const colorBuckets = new Map();
    for (let i = 0; i < sourcePixels.length; i++) {
        const p = sourcePixels[i];
        p.idx = i;
        const bucket = getColorBucket(p.color[0], p.color[1], p.color[2]);
        if (!colorBuckets.has(bucket)) colorBuckets.set(bucket, []);
        colorBuckets.get(bucket).push(p);
    }

    const targetBuckets = [];
    for (let i = 0; i < targetPixels.length; i++) {
        const tp = targetPixels[i];
        tp.idx = i;
        tp.bucket = getColorBucket(tp.color[0], tp.color[1], tp.color[2]);
        targetBuckets.push(tp);
    }

    const bucketTrees = new Map();
    for (const [bucket, points] of colorBuckets) {
        if (points.length > 0) {
            const tree = new FlatKDTree(points, 0);
            tree.build();
            bucketTrees.set(bucket, tree);
        }
    }

    const globalTree = new FlatKDTree([...sourcePixels], 0);
    globalTree.build();

    const unmappedTargets = [];

    for (let i = 0; i < targetBuckets.length; i++) {
        const tp = targetBuckets[i];
        let bestIdx = -1;
        let bestScore = Infinity;
        let bestSource = null;

        const sameBucket = bucketTrees.get(tp.bucket);
        if (sameBucket) {
            const result = sameBucket.nearest(tp.x, tp.y, { dist: Infinity, idx: -1, point: null }, used);
            if (result.idx !== -1) {
                bestIdx = result.idx;
                bestSource = result.point;
                bestScore = 0;
            }
        }

        if (bestIdx === -1) {
            const br = (tp.color[0] >> COLOR_BUCKET_BITS);
            const bg = (tp.color[1] >> COLOR_BUCKET_BITS);
            const bb = (tp.color[2] >> COLOR_BUCKET_BITS);

            for (let dr = -1; dr <= 1 && bestIdx === -1; dr++) {
                for (let dg = -1; dg <= 1 && bestIdx === -1; dg++) {
                    for (let db = -1; db <= 1 && bestIdx === -1; db++) {
                        const nr = br + dr, ng = bg + dg, nb = bb + db;
                        if (nr < 0 || nr >= 32 || ng < 0 || ng >= 32 || nb < 0 || nb >= 32) continue;

                        const neighborBucket = (nr << 10) | (ng << 5) | nb;
                        const tree = bucketTrees.get(neighborBucket);
                        if (!tree) continue;

                        const result = tree.nearest(tp.x, tp.y, { dist: Infinity, idx: -1, point: null }, used);
                        if (result.idx !== -1) {
                            const sp = result.point;
                            const rDiff = tp.color[0] - sp.color[0];
                            const gDiff = tp.color[1] - sp.color[1];
                            const bDiff = tp.color[2] - sp.color[2];
                            const colorPenalty = (rDiff * rDiff + gDiff * gDiff + bDiff * bDiff) * 0.01;

                            const spatialDist = result.dist;
                            const score = spatialDist + colorPenalty;

                            if (score < bestScore) {
                                bestScore = score;
                                bestIdx = result.idx;
                                bestSource = sp;
                            }
                        }
                    }
                }
            }
        }

        if (bestIdx === -1) {
            const result = globalTree.nearest(tp.x, tp.y, { dist: Infinity, idx: -1, point: null }, used);
            if (result.idx !== -1) {
                bestIdx = result.idx;
                bestSource = result.point;
            }
        }

        if (bestIdx !== -1) {
            used[bestIdx] = 1;
            mapping.push({
                fromX: bestSource.origX,
                fromY: bestSource.origY,
                toX: tp.x,
                toY: tp.y,
                color: bestSource.color
            });
        } else {
            unmappedTargets.push(tp);
        }
    }

    for (const tp of unmappedTargets) {
        let nearestDist = Infinity;
        let nearestSource = null;
        for (let i = 0; i < sourcePixels.length; i++) {
            if (!used[i]) {
                const sp = sourcePixels[i];
                const dx = sp.origX - tp.x;
                const dy = sp.origY - tp.y;
                const dist = dx * dx + dy * dy;
                if (dist < nearestDist) {
                    nearestDist = dist;
                    nearestSource = sp;
                }
            }
        }
        if (nearestSource) {
            mapping.push({
                fromX: nearestSource.origX,
                fromY: nearestSource.origY,
                toX: tp.x,
                toY: tp.y,
                color: nearestSource.color
            });
        }
    }

    return mapping;
}

// 主转换函数
async function startConversion(autoPreview = false) {
    if (isConverting && !autoPreview) return;
    if (!sourceImage || !targetImage) {
        if (!autoPreview) alert('请先选择两张图片');
        return;
    }

    isConverting = true;
    const btn = document.getElementById('convertBtn');
    if (btn) btn.disabled = true;

    const previewContainer = document.getElementById('previewContainer');
    if (previewContainer) previewContainer.classList.add('active');
    document.getElementById('videoContainer').style.display = 'none';

    const progress = document.getElementById('progress');
    const previewCanvas = document.getElementById('previewCanvas');

    const easingName = document.getElementById('easingSelect').value;
    currentEasingFn = easingFunctions[easingName] || easingFunctions.easeInOutQuad;
    currentDuration = parseFloat(document.getElementById('durationInput').value) || 5;

    const width = sourceCanvas.width;
    const height = sourceCanvas.height;

    const stretchedTargetCanvas = document.createElement('canvas');
    stretchedTargetCanvas.width = width;
    stretchedTargetCanvas.height = height;
    const stretchCtx = stretchedTargetCanvas.getContext('2d');
    stretchCtx.drawImage(targetCanvas, 0, 0, width, height);
    const stretchedTargetImage = stretchCtx.getImageData(0, 0, width, height);

    // 修复：确保 canvas 尺寸为整数，避免奇数尺寸导致的缝隙
    const displayScale = Math.min(500 / width, 500 / height, 15);
    previewCanvas.width = Math.round(width * displayScale);
    previewCanvas.height = Math.round(height * displayScale);

    if (!gl) {
        if (!initWebGL(previewCanvas)) {
            isConverting = false;
            if (btn) btn.disabled = false;
            return;
        }
    } else {
        gl.viewport(0, 0, previewCanvas.width, previewCanvas.height);
    }

    if (progress) progress.textContent = '正在准备像素数据...';

    try {
        const sourcePixels = [];
        const sw = sourceCanvas.width;
        const sh = sourceCanvas.height;

        for (let y = 0; y < sh; y++) {
            for (let x = 0; x < sw; x++) {
                const color = getPixel(sourceImage.data, x, y, sw);
                sourcePixels.push({
                    origX: x,
                    origY: y,
                    color: color,
                    brightness: (color[0] * 299 + color[1] * 587 + color[2] * 114) / 1000,
                    idx: sourcePixels.length
                });
            }
        }

        const targetPixels = [];
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const color = getPixel(stretchedTargetImage.data, x, y, width);
                targetPixels.push({
                    x, y,
                    color: color,
                    brightness: (color[0] * 299 + color[1] * 587 + color[2] * 114) / 1000
                });
            }
        }

        if (progress) progress.textContent = `源图: ${sourcePixels.length}像素, 目标: ${targetPixels.length}像素 - 开始匹配...`;

        let matchedSources = sourcePixels;
        if (sourcePixels.length > targetPixels.length) {
            const ratio = targetPixels.length / sourcePixels.length;
            matchedSources = [];
            for (let y = 0; y < sh; y++) {
                for (let x = 0; x < sw; x++) {
                    const hash = ((x * 73856093) ^ (y * 19349663)) & 0xFFFFFFFF;
                    if ((hash / 0xFFFFFFFF) < ratio) {
                        const idx = y * sw + x;
                        if (idx < sourcePixels.length) {
                            matchedSources.push(sourcePixels[idx]);
                        }
                    }
                }
            }
            while (matchedSources.length < targetPixels.length) {
                const idx = Math.floor(Math.random() * sourcePixels.length);
                matchedSources.push(sourcePixels[idx]);
            }
            if (matchedSources.length > targetPixels.length) {
                matchedSources.length = targetPixels.length;
            }
        } else if (sourcePixels.length < targetPixels.length) {
            matchedSources = [];
            let idx = 0;
            while (matchedSources.length < targetPixels.length) {
                matchedSources.push(sourcePixels[idx % sourcePixels.length]);
                idx++;
            }
        }

        if (progress) progress.textContent = '正在给像素找匹配...';
        await new Promise(r => setTimeout(r, 0));

        const startTime = performance.now();
        const selectedAlgorithm = document.getElementById('algorithmSelect').value;
        mappingData = runMappingAlgorithm(selectedAlgorithm, matchedSources, targetPixels, sw, sh, width, height);
        const matchTime = performance.now() - startTime;
        console.log(`匹配耗时: ${matchTime.toFixed(2)}ms`);

        if (progress) progress.textContent = '正在上传GPU...';

        uploadPixelData(mappingData, width, height);
        updatePointSize(width, height, previewCanvas.width, previewCanvas.height);

        window.currentMapping = mappingData;
        window.currentWidth = width;
        window.currentHeight = height;

        if (progress) progress.textContent = `完成 (匹配耗时: ${matchTime.toFixed(0)}ms)`;

        animFinished = false;
        const label = document.getElementById('previewLabelText');
        if (label) label.textContent = '实时像素流动预览';
        const indicator = document.getElementById('liveIndicator');
        if (indicator) {
            indicator.style.display = 'inline-block';
            indicator.style.background = '#2196F3';
            indicator.style.animation = 'pulse 1.5s infinite';
        }

        stopPreviewAnimation();
        startPreviewAnimation();

    } catch (err) {
        console.error(err);
        if (progress) progress.textContent = '失败了?!(#°Д°)';
    } finally {
        isConverting = false;
        if (btn) btn.disabled = false;
    }
}

// ==================== 视频录制 ====================
async function generateVideo() {
    if (!window.currentMapping || !gl) {
        alert('请先生成预览（选择两张图片）');
        return;
    }

    if (isRecording) return;
    isRecording = true;

    const btn = document.getElementById('convertBtn');
    if (btn) btn.disabled = true;

    const progress = document.getElementById('progress');
    const previewCanvas = document.getElementById('previewCanvas');
    const easingFn = currentEasingFn;
    const duration = currentDuration;
    const holdFirst = true;
    const holdLast = true;
    const width = window.currentWidth;
    const height = window.currentHeight;

    // 保存原始预览尺寸
    const originalPreviewWidth = previewCanvas.width;
    const originalPreviewHeight = previewCanvas.height;

    try {
        const fps = 30;
        const holdFrames = Math.round(0.5 * fps);
        const animFrames = Math.round(duration * fps);
        const totalFrames = (holdFirst ? holdFrames : 0) + animFrames + (holdLast ? holdFrames : 0);

        if (progress) progress.textContent = '准备录制...';

        // 检测浏览器支持的录制格式，优先 MP4
        const mimeTypes = [
            'video/mp4;codecs=avc1.42E01E',
            'video/mp4;codecs=avc1',
            'video/mp4',
            'video/webm;codecs=vp9',
            'video/webm;codecs=vp8',
            'video/webm'
        ];

        let selectedMimeType = null;
        for (const mt of mimeTypes) {
            if (MediaRecorder.isTypeSupported(mt)) {
                selectedMimeType = mt;
                break;
            }
        }

        if (!selectedMimeType) {
            alert('您的浏览器不支持视频录制');
            isRecording = false;
            if (btn) btn.disabled = false;
            return;
        }

        const isMp4 = selectedMimeType.includes('mp4');
        const fileExt = isMp4 ? 'mp4' : 'webm';

        if (progress) progress.textContent = `使用格式: ${selectedMimeType.split(';')[0].toUpperCase()}，准备高清录制...`;

        // 关键修复：临时将 previewCanvas 放大到原始分辨率进行录制
        // 这样使用同一个 WebGL 上下文，避免 buffer 绑定问题
        previewCanvas.width = width;
        previewCanvas.height = height;
        gl.viewport(0, 0, width, height);
        updatePointSize(width, height, width, height);

        // 重新上传数据到当前上下文（确保 buffer 正确绑定）
        uploadPixelData(window.currentMapping, width, height);
        updatePointSize(width, height, width, height);

        if (progress) progress.textContent = `录制分辨率: ${width}x${height}，开始转视频...`;

        const stream = previewCanvas.captureStream(fps);

        // 码率：MP4 用 16Mbps，WebM 用 8Mbps
        const bitsPerSecond = isMp4 ? 16000000 : 8000000;
        let mediaRecorder;
        try {
            mediaRecorder = new MediaRecorder(stream, {
                mimeType: selectedMimeType,
                videoBitsPerSecond: bitsPerSecond
            });
        } catch (e) {
            // 如果创建失败（比如码率太高），尝试默认配置
            console.warn('MediaRecorder 创建失败，尝试默认配置:', e);
            try {
                mediaRecorder = new MediaRecorder(stream, {
                    mimeType: selectedMimeType
                });
            } catch (e2) {
                // 如果还是失败，降级到 webm
                if (isMp4) {
                    selectedMimeType = 'video/webm;codecs=vp9';
                    mediaRecorder = new MediaRecorder(stream, { mimeType: selectedMimeType });
                } else {
                    throw e2;
                }
            }
        }

        const chunks = [];
        let recorderError = null;

        mediaRecorder.ondataavailable = e => {
            if (e.data.size > 0) chunks.push(e.data);
        };

        mediaRecorder.onerror = (e) => {
            recorderError = e;
            console.error('录制错误:', e);
        };

        mediaRecorder.onstop = () => {
            // 恢复预览 canvas 尺寸
            const displayScale = Math.min(500 / width, 500 / height, 15);
            previewCanvas.width = Math.round(width * displayScale);
            previewCanvas.height = Math.round(height * displayScale);
            gl.viewport(0, 0, previewCanvas.width, previewCanvas.height);
            updatePointSize(width, height, previewCanvas.width, previewCanvas.height);
            // 重新上传数据
            uploadPixelData(window.currentMapping, width, height);
            updatePointSize(width, height, previewCanvas.width, previewCanvas.height);
            // 渲染一帧预览
            renderWebGLFrame(1);

            if (recorderError) {
                if (progress) progress.textContent = '录制失败: ' + (recorderError.message || '编码错误');
                isRecording = false;
                if (btn) btn.disabled = false;
                return;
            }

            const blobType = isMp4 ? 'video/mp4' : 'video/webm';
            const blob = new Blob(chunks, { type: blobType });
            resultBlob = blob;
            resultBlobExt = fileExt;
            const url = URL.createObjectURL(blob);
            const video = document.getElementById('resultVideo');
            video.src = url;
            document.getElementById('videoContainer').style.display = 'block';
            if (progress) progress.textContent = isMp4 ? `MP4 生成完成！分辨率: ${width}x${height}` : `视频生成完成！(WebM 格式，分辨率: ${width}x${height})`;
            isRecording = false;
            if (btn) btn.disabled = false;
        };

        if (progress) progress.textContent = '转视频 (0%)...';

        stopPreviewAnimation();
        mediaRecorder.start();

        for (let frame = 0; frame < totalFrames; frame++) {
            let t;

            if (holdFirst && frame < holdFrames) {
                t = 0;
            } else if (holdFirst && frame >= holdFrames + animFrames) {
                t = 1;
            } else if (!holdFirst && frame >= animFrames) {
                t = 1;
            } else {
                const animFrame = holdFirst ? frame - holdFrames : frame;
                t = animFrame / animFrames;
            }

            renderWebGLFrame(t);

            if (frame % 15 === 0) {
                const percent = Math.round(frame / totalFrames * 100);
                if (progress) progress.textContent = `转视频 (${percent}%)...`;
            }

            await new Promise(r => setTimeout(r, 1000 / fps));
        }

        setTimeout(() => {
            if (mediaRecorder.state !== 'inactive') {
                mediaRecorder.stop();
            }
        }, 100);

    } catch (err) {
        console.error(err);
        if (progress) progress.textContent = '录制失败: ' + (err.message || '未知错误');

        // 出错时恢复预览尺寸
        const displayScale = Math.min(500 / width, 500 / height, 15);
        previewCanvas.width = Math.round(width * displayScale);
        previewCanvas.height = Math.round(height * displayScale);
        if (gl) {
            gl.viewport(0, 0, previewCanvas.width, previewCanvas.height);
            uploadPixelData(window.currentMapping, width, height);
            updatePointSize(width, height, previewCanvas.width, previewCanvas.height);
            renderWebGLFrame(1);
        }

        isRecording = false;
        if (btn) btn.disabled = false;
    }
}

function downloadVideo() {
    if (!resultBlob) return;
    const ext = typeof resultBlobExt !== 'undefined' ? resultBlobExt : 'webm';
    const url = URL.createObjectURL(resultBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pixel-shift-animation.' + ext;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function replayAnimation() {
    stopPreviewAnimation();
    startPreviewAnimation();
}

window.addEventListener('beforeunload', () => {
    stopPreviewAnimation();
    if (gl) {
        gl.deleteProgram(shaderProgram);
        if (fromPosBuffer) gl.deleteBuffer(fromPosBuffer);
        if (toPosBuffer) gl.deleteBuffer(toPosBuffer);
        if (colorBuffer) gl.deleteBuffer(colorBuffer);
    }
});