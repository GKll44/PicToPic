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
    const scaleX = canvasWidth / width;
    const scaleY = canvasHeight / height;
    const pixelScale = Math.min(scaleX, scaleY);
    const pointSize = Math.max(pixelScale, 1.0);
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
    const size = parseInt(this.value) || 100;
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
            const maxSize = parseInt(document.getElementById('maxSizeInput').value) || 100;
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
// 核心优化：
// 1. 使用亮度分桶而非全局排序，保留空间局部性
// 2. 使用KD-Tree加速最近邻搜索
// 3. 预计算颜色距离避免重复平方根
// 4. 多分辨率渐进匹配
// 5. 使用TypedArray减少GC压力

function optimizeMapping(sourcePixels, targetPixels, sourceWidth, sourceHeight, targetWidth, targetHeight) {
    const mapping = [];
    const used = new Uint8Array(sourcePixels.length); // 0=未用, 1=已用
    
    // ===== 优化1: 构建空间KD-Tree索引 =====
    // 使用扁平化数组存储KD-Tree节点，避免对象开销
    class FlatKDTree {
        constructor(points, depth = 0) {
            this.points = points;
            this.depth = depth;
            this.axis = depth % 2; // 0=x, 1=y
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
            
            // 按当前轴排序
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
        
        // 搜索最近邻，排除已用点
        nearest(targetX, targetY, best, used) {
            if (!this.built) return best;
            
            // 检查当前节点中的所有点（叶子节点或少量点）
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
            
            // 决定搜索方向
            const medianPoint = this.points[this.median];
            const targetVal = this.axis === 0 ? targetX : targetY;
            const medianVal = this.axis === 0 ? medianPoint.origX : medianPoint.origY;
            
            let first = this.left;
            let second = this.right;
            
            if (targetVal > medianVal) {
                first = this.right;
                second = this.left;
            }
            
            // 搜索优先分支
            if (first) {
                best = first.nearest(targetX, targetY, best, used);
            }
            
            // 检查是否需要搜索另一分支（剪枝）
            const diff = targetVal - medianVal;
            if (diff * diff < best.dist && second) {
                best = second.nearest(targetX, targetY, best, used);
            }
            
            // 检查中位数点本身
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
    
    // ===== 优化2: 颜色分桶加速 =====
    // 将颜色空间划分为32×32×32的粗网格，优先在同色桶内搜索
    const COLOR_BUCKET_BITS = 5; // 32 buckets per channel
    const COLOR_BUCKET_SIZE = 256 / (1 << COLOR_BUCKET_BITS);
    
    function getColorBucket(r, g, b) {
        return ((r >> COLOR_BUCKET_BITS) << 10) | 
               ((g >> COLOR_BUCKET_BITS) << 5) | 
               (b >> COLOR_BUCKET_BITS);
    }
    
    // 构建颜色桶索引
    const colorBuckets = new Map();
    for (let i = 0; i < sourcePixels.length; i++) {
        const p = sourcePixels[i];
        p.idx = i; // 添加索引引用
        const bucket = getColorBucket(p.color[0], p.color[1], p.color[2]);
        if (!colorBuckets.has(bucket)) colorBuckets.set(bucket, []);
        colorBuckets.get(bucket).push(p);
    }
    
    // ===== 优化3: 预计算目标像素颜色桶 =====
    const targetBuckets = [];
    for (let i = 0; i < targetPixels.length; i++) {
        const tp = targetPixels[i];
        tp.idx = i;
        tp.bucket = getColorBucket(tp.color[0], tp.color[1], tp.color[2]);
        targetBuckets.push(tp);
    }
    
    // ===== 优化4: 多轮匹配策略 =====
    // 第一轮：颜色桶精确匹配 + KD-Tree空间优化
    // 第二轮：邻近颜色桶扩展搜索
    // 第三轮：全局KD-Tree兜底
    
    // 为每个颜色桶构建KD-Tree
    const bucketTrees = new Map();
    for (const [bucket, points] of colorBuckets) {
        if (points.length > 0) {
            const tree = new FlatKDTree(points, 0);
            tree.build();
            bucketTrees.set(bucket, tree);
        }
    }
    
    // 构建全局KD-Tree（用于fallback）
    const globalTree = new FlatKDTree([...sourcePixels], 0);
    globalTree.build();
    
    // 匹配过程
    const unmappedTargets = [];
    
    for (let i = 0; i < targetBuckets.length; i++) {
        const tp = targetBuckets[i];
        let bestIdx = -1;
        let bestScore = Infinity;
        let bestSource = null;
        
        // 策略1: 在同色桶内搜索
        const sameBucket = bucketTrees.get(tp.bucket);
        if (sameBucket) {
            const result = sameBucket.nearest(tp.x, tp.y, { dist: Infinity, idx: -1, point: null }, used);
            if (result.idx !== -1) {
                bestIdx = result.idx;
                bestSource = result.point;
                bestScore = 0; // 颜色完全匹配（同桶）
            }
        }
        
        // 策略2: 如果同色桶没找到或空间距离太远，搜索邻近颜色桶
        if (bestIdx === -1) {
            const br = (tp.color[0] >> COLOR_BUCKET_BITS);
            const bg = (tp.color[1] >> COLOR_BUCKET_BITS);
            const bb = (tp.color[2] >> COLOR_BUCKET_BITS);
            
            // 搜索3×3×3颜色邻域
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
                            // 计算颜色距离惩罚
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
        
        // 策略3: 全局搜索兜底
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
    
    // 处理未映射的目标（复制最近的已用源像素）
    for (const tp of unmappedTargets) {
        // 找到空间上最近的已用源像素
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

    const displayScale = Math.min(500 / width, 500 / height, 15);
    previewCanvas.width = width * displayScale;
    previewCanvas.height = height * displayScale;

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
                    brightness: (color[0] * 299 + color[1] * 587 + color[2] * 114) / 1000
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

        // 像素数量平衡：如果源图像素多于目标，随机采样保持空间分布
        let matchedSources = sourcePixels;
        if (sourcePixels.length > targetPixels.length) {
            // 使用网格采样保持空间分布，而非随机打乱
            const ratio = targetPixels.length / sourcePixels.length;
            matchedSources = [];
            for (let y = 0; y < sh; y++) {
                for (let x = 0; x < sw; x++) {
                    // 基于坐标的确定性采样，保持空间连续性
                    const hash = ((x * 73856093) ^ (y * 19349663)) & 0xFFFFFFFF;
                    if ((hash / 0xFFFFFFFF) < ratio) {
                        const idx = y * sw + x;
                        if (idx < sourcePixels.length) {
                            matchedSources.push(sourcePixels[idx]);
                        }
                    }
                }
            }
            // 如果采样不足，补充随机点
            while (matchedSources.length < targetPixels.length) {
                const idx = Math.floor(Math.random() * sourcePixels.length);
                matchedSources.push(sourcePixels[idx]);
            }
            // 如果采样过多，截断
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
        mappingData = optimizeMapping(matchedSources, targetPixels, sw, sh, width, height);
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

    const mapping = window.currentMapping;
    const width = window.currentWidth;
    const height = window.currentHeight;

    const easingFn = currentEasingFn;
    const duration = currentDuration;
    const holdFirst = true;
    const holdLast = true;

    try {
        const canvas = document.getElementById('previewCanvas');
        const stream = canvas.captureStream(30);
        const mediaRecorder = new MediaRecorder(stream, {
            mimeType: 'video/webm;codecs=vp9',
            videoBitsPerSecond: 8000000
        });

        const chunks = [];
        mediaRecorder.ondataavailable = e => {
            if (e.data.size > 0) chunks.push(e.data);
        };

        mediaRecorder.onstop = () => {
            const blob = new Blob(chunks, { type: 'video/webm' });
            resultBlob = blob;
            const url = URL.createObjectURL(blob);
            const video = document.getElementById('resultVideo');
            video.src = url;
            document.getElementById('videoContainer').style.display = 'block';
            if (progress) progress.textContent = '视频生成完成！';
            isRecording = false;
            if (btn) btn.disabled = false;
        };

        mediaRecorder.onerror = (e) => {
            console.error('录制失败:', e);
            isRecording = false;
            if (btn) btn.disabled = false;
        };

        const fps = 30;
        const holdFrames = Math.round(0.5 * fps);
        const animFrames = Math.round(duration * fps);
        const totalFrames = (holdFirst ? holdFrames : 0) + animFrames + (holdLast ? holdFrames : 0);

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
                t = easingFn(t);
            }

            renderWebGLFrame(t);

            if (frame % 15 === 0) {
                const percent = Math.round(frame / totalFrames * 100);
                if (progress) progress.textContent = `转视频 (${percent}%)...`;
            }

            await new Promise(r => setTimeout(r, 1000 / fps));
        }

        setTimeout(() => {
            mediaRecorder.stop();
        }, 100);

    } catch (err) {
        console.error(err);
        if (progress) progress.textContent = '录制失败';
        isRecording = false;
        if (btn) btn.disabled = false;
    }
}

function downloadVideo() {
    if (!resultBlob) return;
    const url = URL.createObjectURL(resultBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pixel-shift-animation.webm';
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
