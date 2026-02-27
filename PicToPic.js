
let sourceImage = null;
let targetImage = null;
let sourceCanvas = document.createElement('canvas');
let targetCanvas = document.createElement('canvas');
let resultBlob = null;
let isConverting = false;

// 缓动函数库
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

// 更新预计像素数显示
document.getElementById('maxSizeInput').addEventListener('input', function() {
    const size = parseInt(this.value) || 100;
    document.getElementById('pixelCountInfo').textContent = 
`预计最大像素数: ${(size * size).toLocaleString()}`;
});

// 文件选择处理
document.getElementById('sourceInput').addEventListener('change', function(e) {
    handleFile(e.target.files[0], 'source');
});

document.getElementById('targetInput').addEventListener('change', function(e) {
    handleFile(e.target.files[0], 'target');
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
};
img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function resizeImage(img, canvas, maxSize) {
    let width = img.width;
    let height = img.height;

    // 等比例缩小到最大尺寸
    if (width > maxSize || height > maxSize) {
if (width > height) {
    height = Math.round(height * (maxSize / width));
    width = maxSize;
} else {
    width = Math.round(width * (maxSize / height));
    height = maxSize;
}
    }

    // 确保至少1像素
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

function setPixel(data, x, y, width, color) {
    const idx = (y * width + x) * 4;
    data[idx] = color[0];
    data[idx+1] = color[1];
    data[idx+2] = color[2];
    data[idx+3] = 255;
}

function colorDistance(c1, c2) {
    const rmean = (c1[0] + c2[0]) / 2;
    const r = c1[0] - c2[0];
    const g = c1[1] - c2[1];
    const b = c1[2] - c2[2];
    return Math.sqrt(
(2 + rmean/256) * r * r + 
4 * g * g + 
(2 + (255-rmean)/256) * b * b
    );
}

async function startConversion() {
    if (isConverting) return;
    if (!sourceImage || !targetImage) {
alert('请先选择两张图片');
return;
    }

    isConverting = true;
    const btn = document.getElementById('convertBtn');
    btn.disabled = true;
    document.getElementById('resultSection').style.display = 'block';
    document.getElementById('videoContainer').style.display = 'none';

    const progress = document.getElementById('progress');
    const status = document.getElementById('status');
    const previewCanvas = document.getElementById('previewCanvas');

    // 获取动画设置
    const easingName = document.getElementById('easingSelect').value;
    const easingFn = easingFunctions[easingName] || easingFunctions.easeInOutQuad;
    const duration = parseFloat(document.getElementById('durationInput').value) || 5;
    const holdFirst = true;
    const holdLast = true;

    // 使用目标图尺寸作为输出尺寸
    const width = targetCanvas.width;
    const height = targetCanvas.height;

    // 设置预览画布（放大显示）
    const displayScale = Math.min(400 / width, 400 / height, 10);
    previewCanvas.width = width * displayScale;
    previewCanvas.height = height * displayScale;
    const ctx = previewCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    progress.textContent = '正在准备像素数据...';
    status.textContent = '读取颜色信息...';

    try {
// 收集源图像素（
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

// 收集目标图像素位置
const targetPixels = [];
for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
const color = getPixel(targetImage.data, x, y, width);
targetPixels.push({
    x, y,
    color: color,
    brightness: (color[0] * 299 + color[1] * 587 + color[2] * 114) / 1000
});
    }
}

progress.textContent = `源图: ${sourcePixels.length}像素, 目标: ${targetPixels.length}像素 - 开始匹配...`;

// 按亮度排序以优化匹配
sourcePixels.sort((a, b) => a.brightness - b.brightness);
targetPixels.sort((a, b) => a.brightness - b.brightness);

// 如果源图像素多于目标图，随机采样；如果少于目标图，重复使用
let matchedSources = [];
if (sourcePixels.length > targetPixels.length) {
    // 随机选择目标图数量的像素
    const shuffled = [...sourcePixels].sort(() => Math.random() - 0.5);
    matchedSources = shuffled.slice(0, targetPixels.length);
    matchedSources.sort((a, b) => a.brightness - b.brightness);
} else if (sourcePixels.length < targetPixels.length) {
    // 重复使用源像素直到填满目标
    matchedSources = [];
    let idx = 0;
    while (matchedSources.length < targetPixels.length) {
matchedSources.push(sourcePixels[idx % sourcePixels.length]);
idx++;
    }
    matchedSources.sort((a, b) => a.brightness - b.brightness);
} else {
    matchedSources = sourcePixels;
}

// 一对一匹配（相同亮度排序位置）
const mapping = [];
const used = new Set();

for (let i = 0; i < targetPixels.length; i++) {
    if (i % 200 === 0) {
progress.textContent = `正在匹配像素... ${Math.round(i / targetPixels.length * 100)}% (${i}/${targetPixels.length})`;
await new Promise(r => setTimeout(r, 0));
    }

    const tp = targetPixels[i];
    const sp = matchedSources[i];

    // 在源图中找到最接近的未使用像素（局部搜索）
    let bestIdx = -1;
    let minDist = Infinity;
    const searchStart = Math.max(0, i - Math.min(1000, sourcePixels.length / 2));
    const searchEnd = Math.min(sourcePixels.length, i + Math.min(1000, sourcePixels.length / 2));

    for (let j = searchStart; j < searchEnd; j++) {
if (used.has(j)) continue;
const dist = colorDistance(sp.color, sourcePixels[j].color);
if (dist < minDist) {
    minDist = dist;
    bestIdx = j;
}
    }

    if (bestIdx !== -1) {
used.add(bestIdx);
const bestSource = sourcePixels[bestIdx];
mapping.push({
    fromX: bestSource.origX,
    fromY: bestSource.origY,
    toX: tp.x,
    toY: tp.y,
    color: bestSource.color
});
    } else {
// 如果没有找到未使用的，使用当前匹配的
mapping.push({
    fromX: sp.origX,
    fromY: sp.origY,
    toX: tp.x,
    toY: tp.y,
    color: sp.color
});
    }
}

progress.textContent = '正在生成结果图像...';

// 创建结果图像数据
const resultData = new ImageData(width, height);
// 先填充白色背景
resultData.data.fill(255);

// 填充映射的像素
for (const m of mapping) {
    setPixel(resultData.data, m.toX, m.toY, width, m.color);
}

// 显示最终结果
const tempCanvas = document.createElement('canvas');
tempCanvas.width = width;
tempCanvas.height = height;
tempCanvas.getContext('2d').putImageData(resultData, 0, 0);

ctx.drawImage(tempCanvas, 0, 0, previewCanvas.width, previewCanvas.height);
status.textContent = `完成！共处理 ${mapping.length} 个像素 | 动画: ${duration}秒 | 缓动: ${document.getElementById('easingSelect').options[document.getElementById('easingSelect').selectedIndex].text}`;

// 生成动画
progress.textContent = '转视频 (0%)...';
await generateVideo(mapping, width, height, sourceCanvas, resultData, progress, status, easingFn, duration, holdFirst, holdLast);

progress.textContent = '录制完成！';
    } catch (err) {
console.error(err);
status.innerHTML = `<span class="error">错误: ${err.message}</span>`;
progress.textContent = '失败了?!(#°Д°)';
    } finally {
isConverting = false;
btn.disabled = false;
    }
}

async function generateVideo(mapping, width, height, sourceCanvas, targetData, progressEl, statusEl, easingFn, duration, holdFirst, holdLast) {
    return new Promise((resolve, reject) => {
const canvas = document.createElement('canvas');
canvas.width = width;
canvas.height = height;
const ctx = canvas.getContext('2d');

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
    statusEl.textContent = '生成完成！';
    resolve();
};

mediaRecorder.onerror = (e) => {
    reject(new Error('录制失败: ' + e.message));
};

const fps = 30;
const holdFrames = Math.round(0.5 * fps); // 0.5秒 = 15帧
const animFrames = Math.round(duration * fps);
const totalFrames = (holdFirst ? holdFrames : 0) + animFrames + (holdLast ? holdFrames : 0);

const frameDuration = 1000 / fps;
const tempImageData = ctx.createImageData(width, height);

let frame = 0;
let startTime = null;
let lastFrameTime = -1;

function recordFrame(timestamp) {
    if (!startTime) startTime = timestamp;
    const elapsed = timestamp - startTime;

    // 计算当前应该渲染的帧数
    const targetFrame = Math.min(totalFrames, Math.floor(elapsed / frameDuration));

    // 如果已经渲染过这一帧，等待下一帧
    if (targetFrame <= lastFrameTime && frame < totalFrames) {
requestAnimationFrame(recordFrame);
return;
    }

    // 渲染所有落后的帧（追赶）
    while (frame <= targetFrame && frame < totalFrames) {
let t;

if (holdFirst && frame < holdFrames) {
    // 首帧保持阶段 - t=0
    t = 0;
} else if (holdFirst && frame >= holdFrames + animFrames) {
    // 末帧保持阶段 - t=1
    t = 1;
} else if (!holdFirst && frame >= animFrames) {
    // 无首帧保持，但可能有末帧保持
    if (holdLast && frame < totalFrames) {
t = 1;
    } else {
t = 1;
    }
} else {
    // 动画阶段
    const animFrame = holdFirst ? frame - holdFrames : frame;
    t = animFrame / animFrames;
    // 应用缓动函数
    t = easingFn(t);
}

// 清空为白色背景
tempImageData.data.fill(255);

// 插值每个像素的位置
for (let i = 0; i < mapping.length; i++) {
    const m = mapping[i];
    const curX = Math.round(m.fromX + (m.toX - m.fromX) * t);
    const curY = Math.round(m.fromY + (m.toY - m.fromY) * t);

    // 边界检查
    if (curX >= 0 && curX < width && curY >= 0 && curY < height) {
setPixel(tempImageData.data, curX, curY, width, m.color);
    }
}

ctx.putImageData(tempImageData, 0, 0);

if (frame % 15 === 0) {
    const progress = Math.round(frame / totalFrames * 100);
    progressEl.textContent = `转视频 (${progress}%)...`;
}

frame++;
lastFrameTime = targetFrame;
    }

    if (frame < totalFrames) {
requestAnimationFrame(recordFrame);
    } else {
// 确保录制完成
setTimeout(() => {
    mediaRecorder.stop();
}, 100);
    }
}

mediaRecorder.start();
requestAnimationFrame(recordFrame);
    });
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