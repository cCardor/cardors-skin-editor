// ==========================================================================
// === CORE.JS (Altyapı, 3D Motor, Renk Çarkı, Temel Araçlar) ===
// ==========================================================================

let SKIN_RES = 64; 

const canvas2d = document.getElementById('editor-2d-canvas');
const ctx2d = canvas2d.getContext('2d', { willReadFrequently: true });
ctx2d.imageSmoothingEnabled = false;
canvas2d.width = SKIN_RES; canvas2d.height = SKIN_RES;

const renderCanvas = document.getElementById('editor-2d-view');
const renderCtx = renderCanvas.getContext('2d', { willReadFrequently: true });
renderCtx.imageSmoothingEnabled = false;

const selCanvas = document.getElementById('editor-2d-selection');
const selCtx = selCanvas.getContext('2d');
let selectionMask = new Uint8Array(SKIN_RES * SKIN_RES);
let hasSelection = false;
let rectSelData = null; 
let rectSelMode = 'add';
let selectionMarchingOffset = 0; 
let lastAnimTime = 0;

const gridSvg = document.getElementById('editor-2d-grid');

const canvas3d = document.getElementById('editor-3d-canvas');
const orientationCubeCanvas = document.getElementById('view-orientation-cube');
let orientationCubeRenderer = null;
let orientationCubeScene = null;
let orientationCubeCamera = null;
let orientationCubeMesh = null;
const orientationCubeRaycaster = new THREE.Raycaster();
const orientationCubePointer = new THREE.Vector2();

// Global Durum Yöneticileri
let isDrawing = false; 
let isRotating = false; 
let isPanning = false; // EKLENDİ: Tanımsız hata çözüldü
let hasDrawnStroke = false;
let currentModel = 'default'; 
let activeTextures = []; 
let activeTool = 'brush'; 
let isBucketMode = false; 
let isRoundBrushMode = false;
let brushSize = 4;
let brushHardness = 15;
let lastDrawX = null;
let lastDrawY = null;
let strokeOriginalData = null;
let strokeAlphaMap = null;
let strokeDirtyBox = null;
let currentBrushCursorUrl = ''; // SVG İmlecini hafızada tutmak için
let strokePixels = new Set(); 
window.cachedImageData = null;

let toolShortcuts = { brush: 'b', round_brush: 'r', bucket: 'f', eraser: 'e', picker: 'i', swap: 'x', mirror: 'm', grid: 'g', rect_select: 's', magic_wand: 'w', transform: 'v' };
let customizingShortcutFor = null;
let isListeningForKey = false;
let currentKeyTarget = null;

let is2DMode = false;
let isDrawing2D = false;
let mirrorMode = 0; 

// Renk Yöneticileri
let currentR = 0, currentG = 0, currentB = 0; // YENİ: Başlangıç Siyah
let currentH = 0, currentS = 0, currentL = 0, currentA = 1.0;
let secondaryColor = { h: 0, s: 0, l: 100, a: 1.0 }; // Beyaz
let colorHistory = [];

let isCopyModeActive = false;
let hoveredLimbForCopy = null;

const mirrorBasic = document.getElementById('mirror-basic');
const mirrorFull = document.getElementById('mirror-full');
const mirrorFullLabel = document.getElementById('mirror-full-label');
const gridToggle = document.getElementById('grid-toggle');

let historyData = []; let historyStep = -1;

let viewer3d = null;
const bgPicker = document.getElementById('bg-color-picker');
const raycaster = new THREE.Raycaster(); const mouse = new THREE.Vector2();

const wheelCanvas = document.getElementById('custom-triangle-wheel');
wheelCanvas.width = 180; wheelCanvas.height = 180;
const wheelCtx = wheelCanvas.getContext('2d', { willReadFrequently: true });
let wheelDragTarget = null; 

const btn3D = document.getElementById('btn-view-3d');
const btn2D = document.getElementById('btn-view-2d');
const container2D = document.getElementById('editor-2d-container');
const wrapper2D = document.getElementById('editor-2d-wrapper');
let view2D = { x: 0, y: 0, scale: 1 };
let isPanning2D = false;

const refInput = document.getElementById('reference-upload-hidden'); 
let refWindowCounter = 0; 
let isPickingRef = false; 
let is2DGuideVisible = false;

// === KÜRESEL RENK MOTORU ===
function rgbToHslObj(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    let max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) h = s = 0;
    else {
        let d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return { h, s, l };
}

function hslToRgbArr(h, s, l) {
    let r, g, b;
    if (s === 0) r = g = b = l;
    else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1; if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        let q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        let p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1 / 3);
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function drawGrid() {
    if (!gridSvg) return;
    if (!gridToggle.checked) {
        gridSvg.style.display = 'none';
        return;
    }

    // Grid'i tuvalle aynı wrapper içine koyuyoruz. Böylece pan/zoom sırasında
    // hesaplanan ekran koordinatlarına ve yuvarlamaya bağlı kalmadan canvas'ın
    // dönüşümünü birebir devralır.
    const step = 512 / SKIN_RES;

    const commands = [];
    for (let i = 0; i <= SKIN_RES; i++) {
        const x = i * step;
        const y = i * step;
        commands.push(`M ${x} 0 V 512 M 0 ${y} H 512`);
    }
    // Tek path kullanımı kesişimlerde ikinci kez boyamayı engeller.
    gridSvg.innerHTML = `<path d="${commands.join(' ')}" fill="none" stroke="#ffffff" stroke-opacity="0.25" stroke-width="0.35" vector-effect="non-scaling-stroke" shape-rendering="crispEdges"/>`;
    gridSvg.style.display = 'block';
}

function drawGridOn3DTexture() {
    const textureSize = 512;
    const step = textureSize / SKIN_RES;

    // Grid atlasını parça bazında oluştur: bir dış katman açıksa yalnız o
    // parçanın overlay UV'si grid alır; diğer parçalar temel UV gridini korur.
    const atlasScale = 512 / 64;
    const partRegions = {
        head:     { base: [0, 0, 32, 16],  outer: [32, 0, 32, 16] },
        body:     { base: [16, 16, 24, 16], outer: [16, 32, 24, 16] },
        rightLeg: { base: [0, 16, 16, 16],  outer: [0, 32, 16, 16] },
        rightArm: { base: [40, 16, 16, 16], outer: [40, 32, 16, 16] },
        leftLeg:  { base: [16, 48, 16, 16], outer: [0, 48, 16, 16] },
        leftArm:  { base: [32, 48, 16, 16], outer: [48, 48, 16, 16] }
    };
    // Çizgileri yüksek çözünürlüklü texture üzerinde tek fiziksel piksel
    // olarak işaretle. Canvas stroke'u kesişimlerde iki kez yarı saydam piksel
    // ürettiği için köşeler daha koyu görünüyordu.
    const gridMask = new Uint8Array(textureSize * textureSize);
    const gridSource = new Int32Array(textureSize * textureSize);
    gridSource.fill(-1);
    const mark = (x, y, sourceX, sourceY) => {
        if (x < 0 || x >= textureSize || y < 0 || y >= textureSize) return;
        const index = y * textureSize + x;
        // Bir köşe hem yatay hem dikey çizgiye denk gelse bile ilk işaretleme
        // korunur; bu sayede aynı piksel birden fazla kez işlenmez.
        if (!gridMask[index]) {
            gridMask[index] = 1;
            gridSource[index] = Math.max(0, Math.min(textureSize - 1, sourceY)) * textureSize + Math.max(0, Math.min(textureSize - 1, sourceX));
        }
    };
    Object.entries(partRegions).forEach(([part, regions]) => {
        const outerPart = document.querySelector(`.outer-map .part[data-part="${part}"]`);
        const usesOuterLayer = outerPart && !outerPart.classList.contains('off');
        const region = usesOuterLayer ? regions.outer : regions.base;
        const [x, y, w, h] = region;
        const left = Math.round(x * atlasScale);
        const top = Math.round(y * atlasScale);
        const right = Math.min(textureSize - 1, Math.round((x + w) * atlasScale) - 1);
        const bottom = Math.min(textureSize - 1, Math.round((y + h) * atlasScale) - 1);
        const baseLeft = Math.round(regions.base[0] * atlasScale);
        const baseTop = Math.round(regions.base[1] * atlasScale);

        for (let gridX = left; gridX <= right; gridX += step) {
            const lineX = Math.round(gridX);
            for (let pixelY = top; pixelY <= bottom; pixelY++) {
                const sourceX = usesOuterLayer ? baseLeft + lineX - left : lineX;
                const sourceY = usesOuterLayer ? baseTop + pixelY - top : pixelY;
                mark(lineX, pixelY, sourceX, sourceY);
            }
        }
        for (let gridY = top; gridY <= bottom; gridY += step) {
            const lineY = Math.round(gridY);
            for (let pixelX = left; pixelX <= right; pixelX++) {
                const sourceX = usesOuterLayer ? baseLeft + pixelX - left : pixelX;
                const sourceY = usesOuterLayer ? baseTop + lineY - top : lineY;
                mark(pixelX, lineY, sourceX, sourceY);
            }
        }
    });

    // Beyazla "difference" uygulamanın eşdeğeri RGB kanallarını tersine
    // çevirmektir. Her nokta maskede yalnız bir kez işaretlendiğinden,
    // kesişimler çizginin geri kalanıyla tamamen aynı tonda kalır.
    const texture = renderCtx.getImageData(0, 0, textureSize, textureSize);
    const data = texture.data;
    const gridOpacity = 0.18;
    const transparentGridAlpha = Math.round(255 * gridOpacity);
    for (let index = 0; index < gridMask.length; index++) {
        if (!gridMask[index]) continue;
        const offset = index * 4;
        const sourceOffset = (gridSource[index] >= 0 ? gridSource[index] : index) * 4;
        const pixelAlpha = data[offset + 3];

        if (pixelAlpha === 0) {
            // Dış katmanın şeffaf bir pikselinde de çizgi görünsün. Rengi,
            // alttaki temel texture'dan alıp tersine çeviriyoruz; bu nedenle
            // grid skin renginin karşıtı olarak görünmeye devam eder.
            const sourceIsVisible = data[sourceOffset + 3] > 0;
            data[offset] = sourceIsVisible ? 255 - data[sourceOffset] : 150;
            data[offset + 1] = sourceIsVisible ? 255 - data[sourceOffset + 1] : 150;
            data[offset + 2] = sourceIsVisible ? 255 - data[sourceOffset + 2] : 150;
            data[offset + 3] = transparentGridAlpha;
        } else {
            // Düşük opaklıklı karşıt renk: hem çizgi çok daha ince algılanır
            // hem de skin renkleri önceki kadar sert değişmez.
            data[offset] = Math.round(data[offset] * (1 - gridOpacity) + (255 - data[offset]) * gridOpacity);
            data[offset + 1] = Math.round(data[offset + 1] * (1 - gridOpacity) + (255 - data[offset + 1]) * gridOpacity);
            data[offset + 2] = Math.round(data[offset + 2] * (1 - gridOpacity) + (255 - data[offset + 2]) * gridOpacity);
        }
    }
    renderCtx.putImageData(texture, 0, 0);
}

function draw2DGuide() {
    const guideSvg = document.getElementById('editor-2d-guide');
    const s = 512 / 64; 
    const isSlim = currentModel === 'slim';

    const parts = [
        {n:"head top", x:8, y:0, w:8, h:8}, {n:"head bottom", x:16, y:0, w:8, h:8},
        {n:"head right", x:0, y:8, w:8, h:8}, {n:"head front", x:8, y:8, w:8, h:8}, {n:"head left", x:16, y:8, w:8, h:8}, {n:"head back", x:24, y:8, w:8, h:8},
        {n:"hat top", x:40, y:0, w:8, h:8}, {n:"hat bottom", x:48, y:0, w:8, h:8},
        {n:"hat right", x:32, y:8, w:8, h:8}, {n:"hat front", x:40, y:8, w:8, h:8}, {n:"hat left", x:48, y:8, w:8, h:8}, {n:"hat back", x:56, y:8, w:8, h:8},
        {n:"rightLeg top", x:4, y:16, w:4, h:4}, {n:"rightLeg bot...", x:8, y:16, w:4, h:4},
        {n:"rightLeg right", x:0, y:20, w:4, h:12}, {n:"rightLeg front", x:4, y:20, w:4, h:12}, {n:"rightLeg left", x:8, y:20, w:4, h:12}, {n:"rightLeg back", x:12, y:20, w:4, h:12},
        {n:"body top", x:20, y:16, w:8, h:4}, {n:"body bottom", x:28, y:16, w:8, h:4},
        {n:"body right", x:16, y:20, w:4, h:12}, {n:"body front", x:20, y:20, w:8, h:12}, {n:"body left", x:28, y:20, w:4, h:12}, {n:"body back", x:32, y:20, w:8, h:12},
        {n:"jacket top", x:20, y:32, w:8, h:4}, {n:"jacket bottom", x:28, y:32, w:8, h:4},
        {n:"jacket right", x:16, y:36, w:4, h:12}, {n:"jacket front", x:20, y:36, w:8, h:12}, {n:"jacket left", x:28, y:36, w:4, h:12}, {n:"jacket back", x:32, y:36, w:8, h:12},
        {n:"rightPants top", x:4, y:32, w:4, h:4}, {n:"rightPants bot...", x:8, y:32, w:4, h:4},
        {n:"rightPants right", x:0, y:36, w:4, h:12}, {n:"rightPants front", x:4, y:36, w:4, h:12}, {n:"rightPants left", x:8, y:36, w:4, h:12}, {n:"rightPants back", x:12, y:36, w:4, h:12},
        {n:"leftLeg top", x:20, y:48, w:4, h:4}, {n:"leftLeg bot...", x:24, y:48, w:4, h:4},
        {n:"leftLeg right", x:16, y:52, w:4, h:12}, {n:"leftLeg front", x:20, y:52, w:4, h:12}, {n:"leftLeg left", x:24, y:52, w:4, h:12}, {n:"leftLeg back", x:28, y:52, w:4, h:12},
        {n:"leftPants top", x:4, y:48, w:4, h:4}, {n:"leftPants bot...", x:8, y:48, w:4, h:4},
        {n:"leftPants right", x:0, y:52, w:4, h:12}, {n:"leftPants front", x:4, y:52, w:4, h:12}, {n:"leftPants left", x:8, y:52, w:4, h:12}, {n:"leftPants back", x:12, y:52, w:4, h:12}
    ];

    if (!isSlim) {
        parts.push(
            {n:"rightArm top", x:44, y:16, w:4, h:4}, {n:"rightArm bot...", x:48, y:16, w:4, h:4},
            {n:"rightArm right", x:40, y:20, w:4, h:12}, {n:"rightArm front", x:44, y:20, w:4, h:12}, {n:"rightArm left", x:48, y:20, w:4, h:12}, {n:"rightArm back", x:52, y:20, w:4, h:12},
            {n:"rightSleeve top", x:44, y:32, w:4, h:4}, {n:"rightSleeve bot...", x:48, y:32, w:4, h:4},
            {n:"rightSleeve right", x:40, y:36, w:4, h:12}, {n:"rightSleeve front", x:44, y:36, w:4, h:12}, {n:"rightSleeve left", x:48, y:36, w:4, h:12}, {n:"rightSleeve back", x:52, y:36, w:4, h:12},
            {n:"leftArm top", x:36, y:48, w:4, h:4}, {n:"leftArm bot...", x:40, y:48, w:4, h:4},
            {n:"leftArm right", x:32, y:52, w:4, h:12}, {n:"leftArm front", x:36, y:52, w:4, h:12}, {n:"leftArm left", x:40, y:52, w:4, h:12}, {n:"leftArm back", x:44, y:52, w:4, h:12},
            {n:"leftSleeve top", x:52, y:48, w:4, h:4}, {n:"leftSleeve bot...", x:56, y:48, w:4, h:4},
            {n:"leftSleeve right", x:48, y:52, w:4, h:12}, {n:"leftSleeve front", x:52, y:52, w:4, h:12}, {n:"leftSleeve left", x:56, y:52, w:4, h:12}, {n:"leftSleeve back", x:60, y:52, w:4, h:12}
        );
    } else {
        parts.push(
            {n:"rightArm top", x:44, y:16, w:3, h:4}, {n:"rightArm bot...", x:47, y:16, w:3, h:4},
            {n:"rightArm right", x:40, y:20, w:4, h:12}, {n:"rightArm front", x:44, y:20, w:3, h:12}, {n:"rightArm left", x:47, y:20, w:4, h:12}, {n:"rightArm back", x:51, y:20, w:3, h:12},
            {n:"rightSleeve top", x:44, y:32, w:3, h:4}, {n:"rightSleeve bot...", x:47, y:32, w:3, h:4},
            {n:"rightSleeve right", x:40, y:36, w:4, h:12}, {n:"rightSleeve front", x:44, y:36, w:3, h:12}, {n:"rightSleeve left", x:47, y:36, w:4, h:12}, {n:"rightSleeve back", x:51, y:36, w:3, h:12},
            {n:"leftArm top", x:36, y:48, w:3, h:4}, {n:"leftArm bot...", x:39, y:48, w:3, h:4},
            {n:"leftArm right", x:32, y:52, w:4, h:12}, {n:"leftArm front", x:36, y:52, w:3, h:12}, {n:"leftArm left", x:39, y:52, w:4, h:12}, {n:"leftArm back", x:43, y:52, w:3, h:12},
            {n:"leftSleeve top", x:52, y:48, w:3, h:4}, {n:"leftSleeve bot...", x:55, y:48, w:3, h:4},
            {n:"leftSleeve right", x:48, y:52, w:4, h:12}, {n:"leftSleeve front", x:52, y:52, w:3, h:12}, {n:"leftSleeve left", x:55, y:52, w:4, h:12}, {n:"leftSleeve back", x:59, y:52, w:3, h:12}
        );
    }

    let svgHTML = '';
    parts.forEach(p => {
        const rx = p.x * s; const ry = p.y * s; const rw = p.w * s; const rh = p.h * s;
        const [partName, faceName = ''] = p.n.replace('bot...', 'bottom').split(' ');
        const compactPart = partName
            .replace('right', 'R ')
            .replace('left', 'L ')
            .replace('Sleeve', 'Slv')
            .replace('Pants', 'Pant');
        const compactFace = faceName === 'bottom' ? 'Bottom' : faceName.charAt(0).toUpperCase() + faceName.slice(1);
        const fontSize = Math.min(rw <= 32 ? 5.5 : 7.5, rh <= 32 ? 5.5 : 7.5);
        const firstLineY = fontSize + 2;
        const secondLineY = firstLineY + fontSize + 1;
        svgHTML += `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="rgba(255, 255, 255, 0.04)" stroke="rgba(255, 255, 255, 0.5)" stroke-width="1" vector-effect="non-scaling-stroke" />`;
        svgHTML += `<text x="${rx + 2}" y="${ry + firstLineY}" fill="rgba(255,255,255,.95)" font-family="Segoe UI, sans-serif" font-size="${fontSize}px" font-weight="700" style="pointer-events:none;"><tspan x="${rx + 2}">${compactPart}</tspan><tspan x="${rx + 2}" y="${ry + secondLineY}">${compactFace}</tspan></text>`;
    });
    guideSvg.innerHTML = svgHTML;
}

function updateMirrorState() {
    if (mirrorBasic.checked) {
        mirrorFull.disabled = false; mirrorFullLabel.classList.remove('disabled'); mirrorMode = mirrorFull.checked ? 2 : 1;
    } else {
        mirrorFull.disabled = true; mirrorFullLabel.classList.add('disabled'); mirrorMode = 0;
    }
}
mirrorBasic.addEventListener('change', updateMirrorState);
mirrorFull.addEventListener('change', updateMirrorState);

function addToColorHistory() {
    if (currentA <= 0) return;
    const newColor = { h: currentH, s: currentS, l: currentL, a: currentA };
    colorHistory = colorHistory.filter(c => !(c.h === newColor.h && c.s === newColor.s && c.l === newColor.l && c.a === newColor.a));
    colorHistory.unshift(newColor);
    if (colorHistory.length > 14) colorHistory.pop();
    renderColorHistory();
}

function renderColorHistory() {
    const container = document.getElementById('color-history');
    container.innerHTML = '';
    colorHistory.forEach((c, index) => {
        const swatchWrapper = document.createElement('div'); swatchWrapper.className = 'history-swatch';
        swatchWrapper.title = `HSLA(${Math.round(c.h)}, ${Math.round(c.s)}%, ${Math.round(c.l)}%, ${Math.round(c.a * 100)}%)`;
        swatchWrapper.setAttribute('role', 'button');
        swatchWrapper.setAttribute('tabindex', '0');

        // Keskin, çözünürlükten bağımsız çerçeve için renk geçmişi SVG ile çizilir.
        const svgNs = 'http://www.w3.org/2000/svg';
        const swatchSvg = document.createElementNS(svgNs, 'svg');
        swatchSvg.classList.add('history-swatch-svg');
        swatchSvg.setAttribute('viewBox', '0 0 20 20');
        swatchSvg.setAttribute('aria-hidden', 'true');
        const patternId = `history-alpha-grid-${index}`;
        swatchSvg.innerHTML = `
            <defs><pattern id="${patternId}" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="#555"/><path d="M0 0h2v2H0zM2 2h2v2H2z" fill="#777"/></pattern></defs>
            <rect x=".5" y=".5" width="19" height="19" rx="4" fill="url(#${patternId})"/>
            <rect x=".5" y=".5" width="19" height="19" rx="4" fill="hsla(${c.h}, ${c.s}%, ${c.l}%, ${c.a})"/>
            <rect x=".5" y=".5" width="19" height="19" rx="4" fill="none" stroke="rgba(255,255,255,.32)"/>
        `;
        swatchWrapper.appendChild(swatchSvg);
        swatchWrapper.onclick = () => { 
            currentH = c.h; currentS = c.s; currentL = c.l; currentA = c.a; 
            let rgb = hslToRgbArr(currentH / 360, currentS / 100, currentL / 100);
            currentR = rgb[0]; currentG = rgb[1]; currentB = rgb[2];
            updateUIColors(); 
        };
        swatchWrapper.onkeydown = (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); swatchWrapper.click(); } };
        container.appendChild(swatchWrapper);
    });
}

function updateTexture() {
    window.cachedImageData = ctx2d.getImageData(0,0,SKIN_RES,SKIN_RES).data;
    renderCtx.imageSmoothingEnabled = false;
    renderCtx.clearRect(0,0,512,512);
    renderCtx.drawImage(canvas2d, 0, 0, 512, 512);
    if (gridToggle.checked && !is2DMode) drawGridOn3DTexture();
    drawGrid();
    activeTextures.forEach(t => t.needsUpdate = true);
}

function hslToHsv(h, s, l) { s /= 100; l /= 100; let v = l + s * Math.min(l, 1 - l); let s_hsv = v === 0 ? 0 : 2 * (1 - l / v); return { h: h, s: s_hsv, v: v }; }
function hsvToHsl(h, s, v) { let l = v * (1 - s / 2); let s_hsl = (l === 0 || l === 1) ? 0 : (v - l) / Math.min(l, 1 - l); return { h: h, s: s_hsl * 100, l: l * 100 }; }

function drawTriangleWheel() {
    const wheelW = wheelCanvas.width || 180; const wheelH = wheelCanvas.height || 180;
    const cx = wheelW / 2; const cy = wheelH / 2; const outerRadius = 85; const innerRadius = 65;
    wheelCtx.clearRect(0, 0, wheelW, wheelH); const imageData = wheelCtx.createImageData(wheelW, wheelH); const data = imageData.data;
    let hueRad = currentH * Math.PI / 180; let cosH = Math.cos(hueRad); let sinH = Math.sin(hueRad); const R = innerRadius;
    
    for (let y = 0; y < wheelH; y++) {
        for (let x = 0; x < wheelW; x++) {
            let dx = x - cx; let dy = y - cy; let distSq = dx*dx + dy*dy;
            if (distSq > outerRadius * outerRadius) continue;
            let idx = (y * wheelW + x) * 4;

            if (distSq >= R * R) {
                let angle = Math.atan2(-dy, dx) * 180 / Math.PI; if (angle < 0) angle += 360;
                let h_prime = angle / 60; let x_c = 1 - Math.abs((h_prime % 2) - 1); let r_, g_, b_;
                if (h_prime < 1) { r_=1; g_=x_c; b_=0; } else if (h_prime < 2) { r_=x_c; g_=1; b_=0; } else if (h_prime < 3) { r_=0; g_=1; b_=x_c; } else if (h_prime < 4) { r_=0; g_=x_c; b_=1; } else if (h_prime < 5) { r_=x_c; g_=0; b_=1; } else { r_=1; g_=0; b_=x_c; }
                data[idx] = Math.round(r_ * 255); data[idx+1] = Math.round(g_ * 255); data[idx+2] = Math.round(b_ * 255); data[idx+3] = 255;
                continue;
            }
            let rx = dx * cosH - dy * sinH; let ry = dx * sinH + dy * cosH;
            let u = (2 * rx + R) / (3 * R); let v_weight = (1 - u) / 2 - ry / (R * Math.sqrt(3)); let w = 1 - u - v_weight;
            
            if (u >= -0.01 && v_weight >= -0.01 && w >= -0.01) {
                u = Math.max(0, Math.min(1, u)); v_weight = Math.max(0, Math.min(1, v_weight));
                let V = u + v_weight; let S_hsv = V > 0 ? u / V : 0;
                let c = V * S_hsv; let h_prime = currentH / 60; let x_c = c * (1 - Math.abs((h_prime % 2) - 1)); let m = V - c;
                let r_, g_, b_;
                if (h_prime < 1) { r_=c; g_=x_c; b_=0; } else if (h_prime < 2) { r_=x_c; g_=c; b_=0; } else if (h_prime < 3) { r_=0; g_=c; b_=x_c; } else if (h_prime < 4) { r_=0; g_=x_c; b_=c; } else if (h_prime < 5) { r_=x_c; g_=0; b_=c; } else { r_=c; g_=0; b_=x_c; }
                data[idx] = Math.round((r_ + m) * 255); data[idx+1] = Math.round((g_ + m) * 255); data[idx+2] = Math.round((b_ + m) * 255); data[idx+3] = 255;
            }
        }
    }
    wheelCtx.putImageData(imageData, 0, 0);

    let hsv = hslToHsv(currentH, currentS, currentL);
    let u = hsv.s * hsv.v; let v_weight = (1 - hsv.s) * hsv.v; let w = 1 - hsv.v;
    let px_tri = u * R - v_weight * (R / 2) - w * (R / 2); let py_tri = -v_weight * (R * Math.sqrt(3) / 2) + w * (R * Math.sqrt(3) / 2);
    let px_rot = px_tri * Math.cos(-hueRad) - py_tri * Math.sin(-hueRad); let py_rot = px_tri * Math.sin(-hueRad) + py_tri * Math.cos(-hueRad);
    wheelCtx.beginPath(); wheelCtx.arc(cx + px_rot, cy + py_rot, 6, 0, 2 * Math.PI);
    wheelCtx.lineWidth = 2; wheelCtx.strokeStyle = (hsv.v > 0.5 && hsv.s < 0.5) ? '#000' : '#fff'; wheelCtx.stroke();

    let hx = cx + (innerRadius + 10) * Math.cos(-hueRad); let hy = cy + (innerRadius + 10) * Math.sin(-hueRad);
    wheelCtx.beginPath(); wheelCtx.arc(hx, hy, 5, 0, 2 * Math.PI); wheelCtx.fillStyle = '#fff'; wheelCtx.fill();
    wheelCtx.strokeStyle = '#222'; wheelCtx.stroke();
}

function drawSquareWheel() {
    const wheelW = wheelCanvas.width || 180; const wheelH = wheelCanvas.height || 180;
    const cx = wheelW / 2; const cy = wheelH / 2; const outerRadius = 85; const innerRadius = 65;
    const squareSize = 90; const squareLeft = Math.round(cx - squareSize / 2); const squareTop = Math.round(cy - squareSize / 2);
    const imageData = wheelCtx.createImageData(wheelW, wheelH); const data = imageData.data;

    for (let y = 0; y < wheelH; y++) {
        for (let x = 0; x < wheelW; x++) {
            const dx = x - cx; const dy = y - cy; const distSq = dx * dx + dy * dy;
            const index = (y * wheelW + x) * 4;

            // Üçgen moddakiyle aynı dış hue halkası.
            if (distSq >= innerRadius * innerRadius && distSq <= outerRadius * outerRadius) {
                let angle = Math.atan2(-dy, dx) * 180 / Math.PI; if (angle < 0) angle += 360;
                const rgb = hslToRgbArr(angle / 360, 1, 0.5);
                data[index] = rgb[0]; data[index + 1] = rgb[1]; data[index + 2] = rgb[2]; data[index + 3] = 255;
            }

            // Halkadaki üçgenin yerine, seçili hue için doygunluk/parlaklık karesi.
            if (x >= squareLeft && x < squareLeft + squareSize && y >= squareTop && y < squareTop + squareSize) {
                const saturation = (x - squareLeft) / (squareSize - 1);
                const value = 1 - (y - squareTop) / (squareSize - 1);
                const hsl = hsvToHsl(currentH, saturation, value);
                const rgb = hslToRgbArr(hsl.h / 360, hsl.s / 100, hsl.l / 100);
                data[index] = rgb[0]; data[index + 1] = rgb[1]; data[index + 2] = rgb[2]; data[index + 3] = 255;
            }
        }
    }
    wheelCtx.putImageData(imageData, 0, 0);

    const hsv = hslToHsv(currentH, currentS, currentL);
    const markerX = squareLeft + hsv.s * (squareSize - 1);
    const markerY = squareTop + (1 - hsv.v) * (squareSize - 1);
    wheelCtx.beginPath(); wheelCtx.arc(markerX, markerY, 6, 0, 2 * Math.PI);
    wheelCtx.lineWidth = 2; wheelCtx.strokeStyle = hsv.v > 0.5 && hsv.s < 0.5 ? '#000' : '#fff'; wheelCtx.stroke();

    const hueRad = currentH * Math.PI / 180;
    const hx = cx + (innerRadius + 10) * Math.cos(-hueRad); const hy = cy + (innerRadius + 10) * Math.sin(-hueRad);
    wheelCtx.beginPath(); wheelCtx.arc(hx, hy, 5, 0, 2 * Math.PI); wheelCtx.fillStyle = '#fff'; wheelCtx.fill();
    wheelCtx.strokeStyle = '#222'; wheelCtx.stroke();
}

let colorWheelMode = 'triangle';

function drawColorWheel() {
    if (colorWheelMode === 'square') drawSquareWheel();
    else drawTriangleWheel();
}

function setColorWheelMode(mode) {
    colorWheelMode = mode;
    document.getElementById('color-wheel-triangle').classList.toggle('active', mode === 'triangle');
    document.getElementById('color-wheel-square').classList.toggle('active', mode === 'square');
    drawColorWheel();
    if (typeof schedulePreferencesSave === 'function') schedulePreferencesSave();
}

wheelCanvas.addEventListener('mousedown', (e) => { 
    if (colorWheelMode === 'square') {
        const rect = wheelCanvas.getBoundingClientRect(); const cx = wheelCanvas.width / 2; const cy = wheelCanvas.height / 2;
        const x = e.clientX - rect.left; const y = e.clientY - rect.top;
        const dist = Math.hypot(x - cx, y - cy); const squareSize = 90; const squareLeft = cx - squareSize / 2; const squareTop = cy - squareSize / 2;
        if (dist >= 65 && dist <= 85) wheelDragTarget = 'ring';
        else if (x >= squareLeft && x < squareLeft + squareSize && y >= squareTop && y < squareTop + squareSize) wheelDragTarget = 'square';
        handleWheelClick(e);
        return;
    }
    const rect = wheelCanvas.getBoundingClientRect(); const cx = wheelCanvas.width / 2; const cy = wheelCanvas.height / 2;
    const x = e.clientX - rect.left - cx; const y = e.clientY - rect.top - cy;
    const dist = Math.sqrt(x * x + y * y); const outerRadius = 85; const innerRadius = 65;
    if (dist >= innerRadius && dist <= outerRadius) wheelDragTarget = 'ring';
    else if (dist < innerRadius) wheelDragTarget = 'triangle';
    if (wheelDragTarget) handleWheelClick(e); 
});
window.addEventListener('mousemove', (e) => { if (wheelDragTarget) handleWheelClick(e); });
window.addEventListener('mouseup', () => { wheelDragTarget = null; });

function handleWheelClick(e) {
    const rect = wheelCanvas.getBoundingClientRect(); const cx = wheelCanvas.width / 2; const cy = wheelCanvas.height / 2;
    const x = e.clientX - rect.left - cx; const y = e.clientY - rect.top - cy;
    if (wheelDragTarget === 'square') {
        const squareSize = 90; const squareLeft = wheelCanvas.width / 2 - squareSize / 2; const squareTop = wheelCanvas.height / 2 - squareSize / 2;
        const x = Math.max(squareLeft, Math.min(squareLeft + squareSize - 1, e.clientX - rect.left));
        const y = Math.max(squareTop, Math.min(squareTop + squareSize - 1, e.clientY - rect.top));
        const hsl = hsvToHsl(currentH, (x - squareLeft) / (squareSize - 1), 1 - (y - squareTop) / (squareSize - 1));
        currentS = Math.round(hsl.s); currentL = Math.round(hsl.l);
    } else if (wheelDragTarget === 'ring') {
        let angle = Math.atan2(-y, x) * 180 / Math.PI; if (angle < 0) angle += 360; 
        currentH = Math.round(angle);
    } else if (wheelDragTarget === 'triangle') {
        let rad = currentH * Math.PI / 180; let rx = x * Math.cos(rad) - y * Math.sin(rad); let ry = x * Math.sin(rad) + y * Math.cos(rad);
        let R = 65; let u = (2 * rx + R) / (3 * R); let v_weight = (1 - u) / 2 - ry / (R * Math.sqrt(3)); let w = 1 - u - v_weight;
        u = Math.max(0, Math.min(1, u)); v_weight = Math.max(0, Math.min(1, v_weight)); w = Math.max(0, Math.min(1, w));
        let sum = u + v_weight + w; u /= sum; v_weight /= sum; w /= sum;
        let V = u + v_weight; let S_hsv = V > 0 ? u / V : 0;
        let hsl = hsvToHsl(currentH, S_hsv, V); currentS = Math.round(hsl.s); currentL = Math.round(hsl.l);
    }
    let rgb = hslToRgbArr(currentH / 360, currentS / 100, currentL / 100);
    currentR = rgb[0]; currentG = rgb[1]; currentB = rgb[2];
    updateUIColors();
}

function updateUIColors() {
    drawColorWheel();
    document.getElementById('slider-h').value = currentH; 
    document.getElementById('slider-s').value = currentS;
    document.getElementById('slider-l').value = currentL; 
    document.getElementById('slider-a').value = Math.round(currentA * 100);

    // HSL değer alanları, sürgülerle çift yönlü senkron tutulur.
    document.getElementById('val-slider-h').value = currentH;
    document.getElementById('val-slider-s').value = currentS;
    document.getElementById('val-slider-l').value = currentL;
    document.getElementById('val-slider-a').value = Math.round(currentA * 100);
    
    // YENİ: HEX kodunu hesapla ve sağdaki kutucuğa aktar
    const hexR = currentR.toString(16).padStart(2, '0');
    const hexG = currentG.toString(16).padStart(2, '0');
    const hexB = currentB.toString(16).padStart(2, '0');
    document.getElementById('hex-color-code').value = (hexR + hexG + hexB).toUpperCase();

    document.getElementById('slider-h').style.background = `linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)`;
    document.getElementById('slider-s').style.background = `linear-gradient(to right, hsl(${currentH}, 0%, ${currentL}%), hsl(${currentH}, 100%, ${currentL}%))`;
    document.getElementById('slider-l').style.background = `linear-gradient(to right, #000, hsl(${currentH}, ${currentS}%, 50%), #fff)`;
    document.getElementById('slider-a').style.background = `linear-gradient(to right, hsla(${currentH}, ${currentS}%, ${currentL}%, 0), hsla(${currentH}, ${currentS}%, ${currentL}%, 1))`;

    document.getElementById('primary-color').setAttribute('fill', `rgba(${currentR}, ${currentG}, ${currentB}, ${currentA})`);
    document.getElementById('secondary-color').setAttribute('fill', `hsla(${secondaryColor.h}, ${secondaryColor.s}%, ${secondaryColor.l}%, ${secondaryColor.a})`);
    if (typeof schedulePreferencesSave === 'function') schedulePreferencesSave();
}

function updateFromSliders() {
    currentH = parseFloat(document.getElementById('slider-h').value); currentS = parseFloat(document.getElementById('slider-s').value);
    currentL = parseFloat(document.getElementById('slider-l').value); currentA = parseFloat(document.getElementById('slider-a').value) / 100;
    
    let rgb = hslToRgbArr(currentH / 360, currentS / 100, currentL / 100);
    currentR = rgb[0]; currentG = rgb[1]; currentB = rgb[2];
    updateUIColors();
}
document.getElementById('slider-h').addEventListener('input', updateFromSliders); document.getElementById('slider-s').addEventListener('input', updateFromSliders);
document.getElementById('slider-l').addEventListener('input', updateFromSliders); document.getElementById('slider-a').addEventListener('input', updateFromSliders);
['h', 's', 'l', 'a'].forEach(channel => {
    const slider = document.getElementById(`slider-${channel}`);
    const valueInput = document.getElementById(`val-slider-${channel}`);
    const applyTypedValue = () => {
        if (valueInput.value === '') return;
        const typed = Number(valueInput.value);
        if (!Number.isFinite(typed)) return;
        const value = Math.max(Number(slider.min), Math.min(Number(slider.max), Math.round(typed)));
        slider.value = String(value);
        updateFromSliders();
    };
    valueInput.addEventListener('input', applyTypedValue);
    valueInput.addEventListener('change', applyTypedValue);
    valueInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); applyTypedValue(); valueInput.blur(); }
    });
});
document.querySelectorAll('[data-hsl-step]').forEach(button => {
    button.addEventListener('click', () => {
        const channel = button.dataset.hslStep;
        const slider = document.getElementById(`slider-${channel}`);
        slider.value = String(Math.max(Number(slider.min), Math.min(Number(slider.max), Number(slider.value) + Number(button.dataset.step))));
        updateFromSliders();
    });
});
document.getElementById('color-wheel-triangle').addEventListener('click', () => setColorWheelMode('triangle'));
document.getElementById('color-wheel-square').addEventListener('click', () => setColorWheelMode('square'));

document.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', function(e) {
        if (e.target !== this) return; 
        const isActive = this.classList.contains('active');
        document.querySelectorAll('.menu-item').forEach(i => i.classList.remove('active'));
        if (!isActive) this.classList.add('active');
    });
});
window.addEventListener('click', (e) => { if (!e.target.closest('.menu-item')) document.querySelectorAll('.menu-item').forEach(i => i.classList.remove('active')); });
function closeAllMenus() { document.querySelectorAll('.menu-item').forEach(i => i.classList.remove('active')); }

// === TEMPLATE DOSYALARINI YÜKLEME MOTORU ===
function loadTemplateAndCreateDoc(name, res, model) {
    const img = new Image();
    let fileName = "";
    
    // Model ve çözünürlüğe göre dosya adını belirle
    if (model === 'slim' && res === 64) fileName = 'alex.png';
    else if (model === 'default' && res === 64) fileName = 'steve.png';
    else if (model === 'slim' && res === 128) fileName = 'alex128x.png';
    else if (model === 'default' && res === 128) fileName = 'steve128x.png'; 
    
    img.onload = () => {
        // Resim başarıyla yüklenirse dosyayı bu resimle oluştur
        if (typeof createNewDocument === 'function') createNewDocument(name, img, res, model);
    };
    
    img.onerror = () => {
        // Eğer resim dosyası klasörde bulunamazsa sistem çökmesin diye eski gri taslağı açar
        console.warn(`Template dosyası (${fileName}) bulunamadı! Program içi boş şablon kullanılıyor.`);
        if (typeof createNewDocument === 'function') createNewDocument(name, null, res, model);
    };
    
    img.src = fileName;
}

let currentSkinSetupMode = 'new'; 
document.getElementById('menu-new-skin').addEventListener('click', () => { closeAllMenus(); currentSkinSetupMode = 'new'; document.getElementById('skin-modal-title').innerText = "Create New Skin"; document.getElementById('modal-skin-setup').style.display = 'flex'; });
document.getElementById('menu-open-skin').addEventListener('click', () => { closeAllMenus(); currentSkinSetupMode = 'open'; document.getElementById('skin-modal-title').innerText = "Open Existing Skin"; document.getElementById('modal-skin-setup').style.display = 'flex'; });
document.getElementById('btn-skin-cancel').addEventListener('click', () => { document.getElementById('modal-skin-setup').style.display = 'none'; });
document.getElementById('btn-skin-confirm').addEventListener('click', () => {
    document.getElementById('modal-skin-setup').style.display = 'none';
    const selectedModel = document.getElementById('skin-model-select').value;
    const selectedRes = parseInt(document.getElementById('skin-res-select').value, 10);

    if (currentSkinSetupMode === 'new') {
        // YENİ: Artık direkt boş dosya açmak yerine senin template dosyalarını yüklüyor
        const docName = "Skin " + (typeof docIdCounter !== 'undefined' ? docIdCounter : "New");
        loadTemplateAndCreateDoc(docName, selectedRes, selectedModel);
    } else if (currentSkinSetupMode === 'open') {
        currentModel = selectedModel; 
        document.getElementById('texture-upload-hidden').click();
    }
});

document.getElementById('texture-upload-hidden').addEventListener('change', (e) => {
    const file = e.target.files[0]; if (!file) return;
    if (file.name.toLowerCase().endsWith('.pdn')) {
        if (typeof openPdnDocument === 'function') openPdnDocument(file);
        else alert('The PDN reader could not be started. Open the app with pdn_server.py.');
        e.target.value = '';
        return;
    }
    const reader = new FileReader();
    reader.onload = (event) => { 
        const img = new Image(); img.onload = () => { 
            if (typeof createNewDocument === 'function') {
                let res = (img.width === 128 || img.height === 128) ? 128 : 64; 
                
                // Modeli algıla ve dosyayı öyle aç
                const detectedModel = detectSkinModel(img, res);
                createNewDocument(file.name.replace(/\.[^/.]+$/, ""), img, res, detectedModel);
            } 
        }; 
        img.src = event.target.result; 
    }; 
    reader.readAsDataURL(file); e.target.value = ''; 
});

function updateMenuStates() {
    const setCheck = (selector, isActive) => {
        const check = document.querySelector(selector);
        if (check) check.style.opacity = isActive ? '1' : '0';
    };
    setCheck('.check-grid', gridToggle.checked);
    setCheck('.check-3d-layer', document.getElementById('toggle-outer-all').checked);
    setCheck('.check-2d-guide', is2DGuideVisible);
    // View menüsündeki bütün tikler tek merkezden güncellenir.
    [
        ['.check-toolbar', 'window-toolbar'],
        ['.check-color', 'window-color-panel'],
        ['.check-layers', 'window-layers-panel']
    ].forEach(([check, windowId]) => {
        const panel = document.getElementById(windowId);
        setCheck(check, panel && window.getComputedStyle(panel).display !== 'none');
    });
}
function setGridVisible(isVisible) {
    gridToggle.checked = isVisible;
    updateTexture();
    updateMenuStates();
    const gridButton = document.getElementById('tool-grid');
    if (gridButton) gridButton.classList.toggle('active', isVisible);
}

document.getElementById('menu-view-grid').addEventListener('click', () => { closeAllMenus(); setGridVisible(!gridToggle.checked); });
document.getElementById('tool-grid').addEventListener('click', () => setGridVisible(!gridToggle.checked));
document.getElementById('menu-view-layer').addEventListener('click', () => { closeAllMenus(); const layerToggle = document.getElementById('toggle-outer-all'); layerToggle.click(); updateMenuStates(); });
document.getElementById('menu-view-guide').addEventListener('click', () => { closeAllMenus(); document.getElementById('btn-action-guide').click(); });

document.getElementById('btn-shortcuts-close').addEventListener('click', () => { document.getElementById('modal-shortcuts').style.display = 'none'; isListeningForKey = false; currentKeyTarget = null; });
function defaultSaveAsName() {
    const documentName = documents?.[activeDocIndex]?.name || `custom_${currentModel}_skin_${SKIN_RES}x`;
    return documentName.replace(/\.(png|pdn)$/i, '');
}

function normaliseSaveAsName(name) {
    const cleaned = String(name || '').trim().replace(/[\\/:*?"<>|]/g, '_').replace(/\.(png|pdn)$/i, '').replace(/\.+$/g, '');
    return cleaned || `custom_${currentModel}_skin_${SKIN_RES}x`;
}

function downloadBlob(blob, fileName) {
    const link = document.createElement('a');
    const objectUrl = URL.createObjectURL(blob);
    link.download = fileName;
    link.href = objectUrl;
    link.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function skinCanvasAsPngBlob() {
    return new Promise(resolve => canvas2d.toBlob(resolve, 'image/png'));
}

async function saveSkinAsPng(fileBaseName) {
    const fileName = `${fileBaseName}.png`;
    let fileHandle = null;

    // Chromium tabanlı tarayıcılarda kullanıcı dosyanın hem adını hem de
    // klasörünü sistemin yerel "Farklı Kaydet" penceresinden seçer.
    if (window.showSaveFilePicker) {
        try {
            fileHandle = await window.showSaveFilePicker({
                suggestedName: fileName,
                types: [{ description: 'PNG resmi', accept: { 'image/png': ['.png'] } }]
            });
        } catch (error) {
            if (error?.name !== 'AbortError') console.error('Farklı kaydet penceresi açılamadı:', error);
            return;
        }
    }

    const blob = await skinCanvasAsPngBlob();
    if (!blob) {
        alert('The skin PNG could not be prepared.');
        return;
    }

    try {
        if (fileHandle) {
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
        } else {
            // Firefox/Safari gibi File System Access API sunmayan tarayıcılarda
            // tarayıcının normal indirme akışı kullanılır.
            downloadBlob(blob, fileName);
        }

        if (documents?.[activeDocIndex]) {
            documents[activeDocIndex].name = fileBaseName;
            updateDocumentTabsUI();
            saveCurrentDocumentState();
        }
    } catch (error) {
        console.error('Dosya kaydedilemedi:', error);
        alert('The file could not be saved. Please try again.');
    }
}

function openSaveAsDialog() {
    const nameInput = document.getElementById('save-as-name');
    nameInput.value = defaultSaveAsName();
    document.getElementById('modal-save-as').style.display = 'flex';
    requestAnimationFrame(() => { nameInput.focus(); nameInput.select(); });
}

document.getElementById('menu-download-skin').addEventListener('click', () => {
    closeAllMenus();
    openSaveAsDialog();
});
document.getElementById('btn-save-as-cancel').addEventListener('click', () => {
    document.getElementById('modal-save-as').style.display = 'none';
});
document.getElementById('btn-save-as-confirm').addEventListener('click', async () => {
    const fileBaseName = normaliseSaveAsName(document.getElementById('save-as-name').value);
    document.getElementById('modal-save-as').style.display = 'none';
    await saveSkinAsPng(fileBaseName);
});
document.getElementById('menu-view-bg').addEventListener('click', () => { closeAllMenus(); document.getElementById('bg-color-picker').click(); });

document.getElementById('menu-add-reference').addEventListener('click', () => { closeAllMenus(); refInput.click(); });
refInput.addEventListener('change', (e) => {
    const files = e.target.files; if (!files || files.length === 0) return;
    Array.from(files).forEach(file => { const reader = new FileReader(); reader.onload = (event) => { const img = new Image(); img.onload = () => { createReferenceWindow(img); }; img.src = event.target.result; }; reader.readAsDataURL(file); }); e.target.value = ''; 
});

function createReferenceWindow(img) {
    refWindowCounter++; let w = img.width; let h = img.height; const maxW = 350; const maxH = 400; 
    if (w > maxW) { h = Math.round((h * maxW) / w); w = maxW; } if (h > maxH) { w = Math.round((w * maxH) / h); h = maxH; } w = Math.max(w, 150); h = Math.max(h, 150);
    const win = document.createElement('div'); win.className = 'ref-window';
    if (img.width === img.height && (img.width === 64 || img.width === 128)) win.classList.add('pixel-reference');
    win.id = 'ref-win-' + refWindowCounter; const offset = (refWindowCounter % 10) * 25; win.style.left = (260 + offset) + 'px'; win.style.top = (70 + offset) + 'px'; win.style.width = w + 'px'; win.style.height = (h + 28) + 'px';
    win.innerHTML = `<div class="ref-header"><span class="ref-title"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m5.5 17 4.5-4 3 2.5 2-1.5 3.5 3"/></svg>Ref ${refWindowCounter}</span><div class="ref-controls"><button class="ref-btn ref-zoom-out" title="Zoom Out" aria-label="Zoom Out"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"/></svg></button><button class="ref-btn ref-zoom-in" title="Zoom In" aria-label="Zoom In"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg></button><span class="ref-control-divider"></span><button class="ref-btn ref-close-btn" title="Close" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg></button></div></div><div class="ref-content"><canvas class="ref-canvas"></canvas></div>`;
    document.body.appendChild(win);
    const canvas = win.querySelector('.ref-canvas'); const ctx = canvas.getContext('2d', { willReadFrequently: true }); canvas.width = img.width; canvas.height = img.height; ctx.drawImage(img, 0, 0);
    let refZoom = 100; let isRefDragging = false; let startX = 0, startY = 0; const header = win.querySelector('.ref-header');
    function bringToFront() { document.querySelectorAll('.ref-window').forEach(w => w.style.zIndex = 1500); win.style.zIndex = 1501; } win.addEventListener('mousedown', bringToFront);
    header.addEventListener('mousedown', (e) => { if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return; isRefDragging = true; startX = e.clientX - win.offsetLeft; startY = e.clientY - win.offsetTop; });
    window.addEventListener('mousemove', (e) => { if (isRefDragging) { win.style.left = (e.clientX - startX) + 'px'; win.style.top = (e.clientY - startY) + 'px'; } });
    window.addEventListener('mouseup', () => { isRefDragging = false; });
    win.querySelector('.ref-close-btn').addEventListener('click', () => { win.remove(); });
    win.querySelector('.ref-zoom-in').addEventListener('click', () => { refZoom += 25; canvas.style.width = refZoom + '%'; canvas.style.height = refZoom + '%'; });
    win.querySelector('.ref-zoom-out').addEventListener('click', () => { refZoom = Math.max(25, refZoom - 25); canvas.style.width = refZoom + '%'; canvas.style.height = refZoom + '%'; });
    function pickReferenceColor(e) {
        const rect = canvas.getBoundingClientRect();
        const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
        const drawnWidth = canvas.width * scale; const drawnHeight = canvas.height * scale;
        const offsetX = (rect.width - drawnWidth) / 2; const offsetY = (rect.height - drawnHeight) / 2;
        const mouseX = e.clientX - rect.left - offsetX; const mouseY = e.clientY - rect.top - offsetY;
        if (mouseX < 0 || mouseX >= drawnWidth || mouseY < 0 || mouseY >= drawnHeight) return;
        const imgX = Math.min(canvas.width - 1, Math.floor(mouseX / scale));
        const imgY = Math.min(canvas.height - 1, Math.floor(mouseY / scale));
        const pixel = ctx.getImageData(imgX, imgY, 1, 1).data;
        if (pixel[3] === 0) return;
        currentR = pixel[0]; currentG = pixel[1]; currentB = pixel[2]; currentA = pixel[3] / 255;
        const hsl = rgbToHslObj(currentR, currentG, currentB);
        currentH = Math.round(hsl.h * 360); currentS = Math.round(hsl.s * 100); currentL = Math.round(hsl.l * 100);
        updateUIColors();
    }
    canvas.addEventListener('mousedown', (e) => { isPickingRef = true; pickReferenceColor(e); });
    canvas.addEventListener('mousemove', (e) => { if (isPickingRef) pickReferenceColor(e); });
    window.addEventListener('mouseup', () => { isPickingRef = false; });
}

function createOrientationFaceTexture(label) {
    const textureCanvas = document.createElement('canvas');
    textureCanvas.width = textureCanvas.height = 128;
    const textureCtx = textureCanvas.getContext('2d');
    textureCtx.fillStyle = '#202020';
    textureCtx.fillRect(0, 0, 128, 128);
    textureCtx.strokeStyle = '#a4a4a4';
    textureCtx.lineWidth = 4;
    textureCtx.strokeRect(3, 3, 122, 122);
    textureCtx.fillStyle = '#f1f1f1';
    textureCtx.font = label.length > 3 ? '700 22px Arial' : '700 30px Arial';
    textureCtx.textAlign = 'center';
    textureCtx.textBaseline = 'middle';
    textureCtx.fillText(label, 64, 66);
    const texture = new THREE.CanvasTexture(textureCanvas);
    texture.colorSpace = THREE.SRGBColorSpace || texture.colorSpace;
    return texture;
}

function updateOrientationCube() {
    if (!orientationCubeRenderer || !orientationCubeMesh || !viewer3d || is2DMode) return;
    // Küp, ana kameranın ters yönüyle döner: görünen yüzler mevcut bakış yönünü anlatır.
    orientationCubeMesh.quaternion.copy(viewer3d.camera.quaternion).invert();
    orientationCubeRenderer.render(orientationCubeScene, orientationCubeCamera);
}

function snapCameraToOrientation(direction) {
    if (!viewer3d?.camera || !viewer3d?.controls) return;
    const target = viewer3d.controls.target.clone();
    const distance = Math.max(1, viewer3d.camera.position.distanceTo(target));
    direction.normalize();
    viewer3d.camera.position.copy(target).addScaledVector(direction, distance);
    // OrbitControls kendi sabit Y eksenini kullanır. Bu ekseni üst/alt görünümde
    // değiştirmek, sonraki fare döndürmelerinin yönünü bozuyordu.
    viewer3d.camera.up.set(0, 1, 0);
    viewer3d.camera.lookAt(target);
    viewer3d.controls.target.copy(target);
    viewer3d.controls.update();
    if (typeof viewer3d.render === 'function') viewer3d.render();
    else viewer3d.renderer.render(viewer3d.scene, viewer3d.camera);
    updateOrientationCube();
}

function initOrientationCube() {
    if (!orientationCubeCanvas || orientationCubeRenderer) return;
    orientationCubeRenderer = new THREE.WebGLRenderer({ canvas: orientationCubeCanvas, alpha: true, antialias: true });
    orientationCubeRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    orientationCubeRenderer.setSize(118, 118, false);
    orientationCubeScene = new THREE.Scene();
    orientationCubeCamera = new THREE.OrthographicCamera(-1.25, 1.25, 1.25, -1.25, 0.1, 10);
    orientationCubeCamera.position.set(0, 0, 5);
    const faceLabels = ['RIGHT', 'LEFT', 'TOP', 'BOTTOM', 'FRONT', 'BACK'];
    const materials = faceLabels.map(label => new THREE.MeshBasicMaterial({ map: createOrientationFaceTexture(label) }));
    orientationCubeMesh = new THREE.Mesh(new THREE.BoxGeometry(1.25, 1.25, 1.25), materials);
    orientationCubeScene.add(orientationCubeMesh);

    const selectFace = (event) => {
        const bounds = orientationCubeCanvas.getBoundingClientRect();
        orientationCubePointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
        orientationCubePointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
        orientationCubeRaycaster.setFromCamera(orientationCubePointer, orientationCubeCamera);
        const hit = orientationCubeRaycaster.intersectObject(orientationCubeMesh, false)[0];
        if (hit?.face) snapCameraToOrientation(hit.face.normal.clone());
    };
    orientationCubeCanvas.addEventListener('click', selectFace);
    orientationCubeCanvas.addEventListener('keydown', (event) => {
        const directions = { ArrowUp: new THREE.Vector3(0, 1, 0), ArrowDown: new THREE.Vector3(0, -1, 0), ArrowLeft: new THREE.Vector3(-1, 0, 0), ArrowRight: new THREE.Vector3(1, 0, 0) };
        if (!directions[event.key]) return;
        event.preventDefault();
        snapCameraToOrientation(directions[event.key]);
    });
    updateOrientationCube();
}

function init3DViewer() {
    if (!window.skinview3d || !window.skinview3d.SkinViewer) { console.error("skinview3d yüklenemedi."); return false; }
    try {
        viewer3d = new skinview3d.SkinViewer({ canvas: canvas3d, width: 1200, height: 900, alpha: true });
        viewer3d.camera.position.set(0, 8, 60);
        if (viewer3d.controls) {
            viewer3d.controls.enableZoom = true; viewer3d.controls.enableRotate = true; viewer3d.controls.target.set(0, 8, 0);
            // OrbitControls varsayılanında sağ tuş kaydırma içindir; editörde her iki
            // fare tuşuyla da modeli döndürmek istiyoruz.
            if (viewer3d.controls.mouseButtons && THREE.MOUSE) viewer3d.controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
            viewer3d.controls.addEventListener?.('change', updateOrientationCube);
        }
        viewer3d.scene.background = new THREE.Color(bgPicker.value);
        initOrientationCube();
        return true;
    } catch (err) { return false; }
}

let screenshot3DBlob = null;
let screenshot3DUrl = null;

function cropTransparentScreenshot(sourceCanvas) {
    // WebGL canvas'ından doğrudan 2D context alınamaz; önce piksel kopyası oluştur.
    const snapshot = document.createElement('canvas');
    snapshot.width = sourceCanvas.width; snapshot.height = sourceCanvas.height;
    const snapshotCtx = snapshot.getContext('2d', { willReadFrequently: true });
    snapshotCtx.drawImage(sourceCanvas, 0, 0);
    const pixels = snapshotCtx.getImageData(0, 0, snapshot.width, snapshot.height).data;
    let left = snapshot.width, top = snapshot.height, right = -1, bottom = -1;
    for (let y = 0; y < snapshot.height; y++) {
        for (let x = 0; x < snapshot.width; x++) {
            if (pixels[(y * snapshot.width + x) * 4 + 3] === 0) continue;
            left = Math.min(left, x); top = Math.min(top, y);
            right = Math.max(right, x); bottom = Math.max(bottom, y);
        }
    }
    if (right < left || bottom < top) return snapshot;

    const padding = 12;
    left = Math.max(0, left - padding); top = Math.max(0, top - padding);
    right = Math.min(snapshot.width - 1, right + padding);
    bottom = Math.min(snapshot.height - 1, bottom + padding);
    const result = document.createElement('canvas');
    result.width = right - left + 1; result.height = bottom - top + 1;
    result.getContext('2d').drawImage(snapshot, left, top, result.width, result.height, 0, 0, result.width, result.height);
    return result;
}

function cropScreenshotToVisibleModel(sourceCanvas) {
    if (!viewer3d?.playerObject || !viewer3d?.camera) return cropTransparentScreenshot(sourceCanvas);

    // WebGL bazı tarayıcılarda saydam zeminin alfasını 1 olarak okuyabildiği için
    // kırpmayı alfa kanalına değil, görünür model geometrisinin ekran sınırına göre yaparız.
    viewer3d.playerObject.updateMatrixWorld(true);
    viewer3d.camera.updateMatrixWorld();
    let hasVisibleMesh = false;
    let left = sourceCanvas.width, top = sourceCanvas.height, right = -1, bottom = -1;
    // playerObject içinde skin dışında yardımcı/efekt nesneleri de bulunabilir.
    // Sadece altı gerçek vücut parçasının iç ve dış katmanlarını hesaba katıyoruz.
    const skin = viewer3d.playerObject.skin;
    const bodyParts = ['head', 'body', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];
    bodyParts.forEach(partName => {
        const part = skin?.[partName];
        ['innerLayer', 'outerLayer'].forEach(layerName => {
            const layer = part?.[layerName];
            if (!layer) return;
            layer.traverse(child => {
                if (!child.isMesh || !child.geometry || !isMeshVisible(child)) return;
                const positions = child.geometry.getAttribute('position');
                if (!positions) return;
                for (let i = 0; i < positions.count; i++) {
                    const projected = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(child.matrixWorld).project(viewer3d.camera);
                    // Kameranın arkasındaki veya uzak kesim düzleminin dışındaki
                    // verteksler projeksiyonu yapay biçimde genişletmesin.
                    if (projected.z < -1 || projected.z > 1) continue;
                    const x = (projected.x * 0.5 + 0.5) * sourceCanvas.width;
                    const y = (-projected.y * 0.5 + 0.5) * sourceCanvas.height;
                    left = Math.min(left, x); top = Math.min(top, y);
                    right = Math.max(right, x); bottom = Math.max(bottom, y);
                    hasVisibleMesh = true;
                }
            });
        });
    });
    if (!hasVisibleMesh || !Number.isFinite(left) || right <= left || bottom <= top) return cropTransparentScreenshot(sourceCanvas);

    const padding = 8;
    left = Math.max(0, Math.floor(left - padding)); top = Math.max(0, Math.floor(top - padding));
    right = Math.min(sourceCanvas.width - 1, Math.ceil(right + padding)); bottom = Math.min(sourceCanvas.height - 1, Math.ceil(bottom + padding));
    const result = document.createElement('canvas');
    result.width = right - left + 1; result.height = bottom - top + 1;
    result.getContext('2d').drawImage(sourceCanvas, left, top, result.width, result.height, 0, 0, result.width, result.height);
    return result;
}

async function take3DScreenshot() {
    if (!viewer3d || !viewer3d.renderer) return;
    const renderer = viewer3d.renderer;
    const originalBackground = viewer3d.scene.background;
    const originalClearColor = new THREE.Color();
    renderer.getClearColor(originalClearColor);
    const originalClearAlpha = renderer.getClearAlpha();

    try {
        // Sadece dış ortamı saydamlaştırır; skin dokusu ve 3D katmanları aynen kalır.
        viewer3d.scene.background = null;
        renderer.setClearColor(0x000000, 0);
        if (typeof viewer3d.render === 'function') viewer3d.render();
        else renderer.render(viewer3d.scene, viewer3d.camera);

        const cropped = cropScreenshotToVisibleModel(canvas3d);
        const blob = await new Promise(resolve => cropped.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('The PNG could not be created.');

        screenshot3DBlob = blob;
        if (screenshot3DUrl) URL.revokeObjectURL(screenshot3DUrl);
        screenshot3DUrl = URL.createObjectURL(blob);
        document.getElementById('screenshot-3d-preview').src = screenshot3DUrl;
        document.getElementById('modal-3d-screenshot').style.display = 'flex';
    } catch (error) {
        console.error('3D ekran görüntüsü alınamadı:', error);
        alert('The 3D screenshot could not be created.');
    } finally {
        viewer3d.scene.background = originalBackground;
        renderer.setClearColor(originalClearColor, originalClearAlpha);
        if (typeof viewer3d.render === 'function') viewer3d.render();
        else renderer.render(viewer3d.scene, viewer3d.camera);
    }
}

document.getElementById('btn-3d-screenshot').addEventListener('click', take3DScreenshot);
document.getElementById('btn-screenshot-close').addEventListener('click', () => {
    document.getElementById('modal-3d-screenshot').style.display = 'none';
});
document.getElementById('btn-screenshot-download').addEventListener('click', () => {
    if (!screenshot3DUrl) return;
    const link = document.createElement('a');
    link.href = screenshot3DUrl;
    link.download = `minecraft_skin_3d_${Date.now()}.png`;
    link.click();
});
document.getElementById('btn-screenshot-copy').addEventListener('click', async () => {
    if (!screenshot3DBlob || !navigator.clipboard || !window.ClipboardItem) {
        alert('This browser does not support copying PNG images to the clipboard.');
        return;
    }
    try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': screenshot3DBlob })]);
        document.getElementById('btn-screenshot-copy').textContent = 'Copied';
        setTimeout(() => { document.getElementById('btn-screenshot-copy').textContent = 'Copy'; }, 1500);
    } catch (error) {
        console.error('PNG panoya kopyalanamadı:', error);
        alert('The image could not be copied to the clipboard.');
    }
});

canvas3d.addEventListener('wheel', (e) => { if (isRotating) { e.preventDefault(); viewer3d.zoom *= (e.deltaY > 0 ? 0.9 : 1.1); } }, { passive: false });
canvas3d.addEventListener('contextmenu', (e) => e.preventDefault());
bgPicker.addEventListener('input', (e) => {
    if(viewer3d) viewer3d.scene.background = new THREE.Color(e.target.value);
    if (typeof schedulePreferencesSave === 'function') schedulePreferencesSave();
});

function drawTemplateFallback(ctxToUse) {
    const s = SKIN_RES / 64; ctxToUse.imageSmoothingEnabled = false; ctxToUse.clearRect(0, 0, SKIN_RES, SKIN_RES); ctxToUse.fillStyle = '#b0bec5'; ctxToUse.fillRect(0, 0, SKIN_RES, SKIN_RES); ctxToUse.fillStyle = '#ffccaa'; ctxToUse.fillRect(8*s, 8*s, 8*s, 8*s); ctxToUse.fillStyle = '#263238'; ctxToUse.fillRect(10*s, 12*s, 2*s, 2*s); ctxToUse.fillRect(14*s, 12*s, 2*s, 2*s); ctxToUse.strokeStyle = '#90a4ae'; ctxToUse.lineWidth = 1*s; ctxToUse.strokeRect(0, 16*s, 64*s, 48*s);
}

function loadDefaultTexture(modelType) { 
    currentModel = modelType; 
    if(typeof createLayerObj === 'function') {
        layers = []; activeLayerIndex = 0; layerIdCounter = 0;
        const baseLayer = createLayerObj("Background");
        drawTemplateFallback(baseLayer.ctx);
        layers.push(baseLayer);
        if(typeof updateLayerUI === 'function') updateLayerUI();
        if(typeof renderComposite === 'function') renderComposite();
    } else {
        drawTemplateFallback(ctx2d);
    }
    applyLiveTexture(currentModel); 
}

function applyLiveTexture(modelType) {
    draw2DGuide(); 
    if (!viewer3d) { if (!init3DViewer()) return Promise.reject(new Error("The 3D viewer is not ready.")); }
    return viewer3d.loadSkin(canvas2d.toDataURL(), { model: modelType }).then(() => {
        activeTextures = []; 
        viewer3d.scene.children.forEach(child => { if (child.isLight) child.visible = false; });
        viewer3d.playerObject.traverse((child) => {
            if (child.isMesh && child.material) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(mat => {
                    if (mat.map) {
                        mat.map.image = renderCanvas; mat.map.magFilter = THREE.NearestFilter; mat.map.minFilter = THREE.NearestFilter; mat.map.needsUpdate = true;
                        mat.emissiveMap = mat.map; mat.emissive = new THREE.Color(0xffffff); mat.color = new THREE.Color(0x000000); mat.transparent = true; mat.alphaTest = 0.01; 
                        activeTextures.push(mat.map); 
                    }
                });
            }
        });
        const sk = viewer3d.playerObject.skin;
        if (sk.rightArm.userData.origY === undefined) { sk.rightArm.userData.origY = sk.rightArm.position.y; sk.leftArm.userData.origY = sk.leftArm.position.y; }
        if (modelType === 'slim') {
            sk.rightArm.position.y = sk.rightArm.userData.origY - 0.5; sk.leftArm.position.y = sk.leftArm.userData.origY - 0.5;
            if (sk.rightArm.outerLayer) sk.rightArm.outerLayer.position.y = 0; if (sk.leftArm.outerLayer) sk.leftArm.outerLayer.position.y = 0;
        } else {
            sk.rightArm.position.y = sk.rightArm.userData.origY; sk.leftArm.position.y = sk.leftArm.userData.origY;
            if (sk.rightArm.outerLayer) sk.rightArm.outerLayer.position.y = 0; if (sk.leftArm.outerLayer) sk.leftArm.outerLayer.position.y = 0;
        }
        enforceUIVisibilityState(); updateTexture();
        updateOrientationCube();
    }).catch(e => console.error("Doku Yükleme Hatası:", e));
}

function centerCameraOnVisibleParts() {
    if (!viewer3d?.playerObject || !viewer3d.controls) return;

    const box = new THREE.Box3();
    let hasVisible = false;
    viewer3d.playerObject.traverse((child) => {
        // Bir parçanın bütün üst grupları da görünür olmalı. Böylece kapatılmış
        // gövde parçaları kameranın odağına yanlışlıkla dahil edilmez.
        if (!child.isMesh || !isMeshVisible(child)) return;

        const childBox = new THREE.Box3().setFromObject(child);
        box.union(childBox);
        hasVisible = true;
    });

    if (hasVisible && !box.isEmpty()) {
        const center = new THREE.Vector3();
        box.getCenter(center);
        viewer3d.controls.target.copy(center);
    } else {
        viewer3d.controls.target.set(0, 8, 0);
    }

    // OrbitControls hedefi hemen yeniden hesaplamazsa yalnızca kafa açıkken
    // eski gövde odağı korunabiliyordu.
    viewer3d.controls.update();
}

document.querySelectorAll('.body-map .part').forEach(btn => { btn.addEventListener('click', function() { this.classList.toggle('off'); enforceUIVisibilityState(); if (gridToggle.checked) updateTexture(); }); });
document.getElementById('toggle-inner-all').addEventListener('change', e => { const isChecked = e.target.checked; document.querySelectorAll('.inner-map .part').forEach(btn => { if(isChecked) btn.classList.remove('off'); else btn.classList.add('off'); }); enforceUIVisibilityState(); });
document.getElementById('toggle-outer-all').addEventListener('change', e => { const isChecked = e.target.checked; document.querySelectorAll('.outer-map .part').forEach(btn => { if(isChecked) btn.classList.remove('off'); else btn.classList.add('off'); }); enforceUIVisibilityState(); if (gridToggle.checked) updateTexture(); });

function enforceUIVisibilityState() {
    document.querySelectorAll('.body-map .part').forEach(btn => {
        const layer = btn.getAttribute('data-layer'); const part = btn.getAttribute('data-part'); const isVisible = !btn.classList.contains('off');
        if(viewer3d.playerObject.skin[part] && viewer3d.playerObject.skin[part][layer]) { viewer3d.playerObject.skin[part][layer].visible = isVisible; }
    });
    centerCameraOnVisibleParts(); 
}

function isMeshVisible(obj) { let curr = obj; while(curr) { if(!curr.visible) return false; curr = curr.parent; } return true; }
function getSkinFaces(isSlim, scale) {
    function getPartBoxes(ox, oy, w, h, d) { return [[(ox+d)*scale, oy*scale, w*scale, d*scale], [(ox+d+w)*scale, oy*scale, w*scale, d*scale], [ox*scale, (oy+d)*scale, d*scale, h*scale], [(ox+d)*scale, (oy+d)*scale, w*scale, h*scale], [(ox+d+w)*scale, (oy+d)*scale, d*scale, h*scale], [(ox+d+w+d)*scale, (oy+d)*scale, w*scale, h*scale]]; }
    let faces = [...getPartBoxes(0, 0, 8, 8, 8), ...getPartBoxes(32, 0, 8, 8, 8), ...getPartBoxes(16, 16, 8, 12, 4), ...getPartBoxes(16, 32, 8, 12, 4), ...getPartBoxes(0, 16, 4, 12, 4), ...getPartBoxes(0, 32, 4, 12, 4), ...getPartBoxes(16, 48, 4, 12, 4), ...getPartBoxes(0, 48, 4, 12, 4)];
    if (isSlim) { faces.push(...getPartBoxes(40, 16, 3, 12, 4), ...getPartBoxes(40, 32, 3, 12, 4), ...getPartBoxes(32, 48, 3, 12, 4), ...getPartBoxes(48, 48, 3, 12, 4)); } 
    else { faces.push(...getPartBoxes(40, 16, 4, 12, 4), ...getPartBoxes(40, 32, 4, 12, 4), ...getPartBoxes(32, 48, 4, 12, 4), ...getPartBoxes(48, 48, 4, 12, 4)); }
    return faces;
}
function getBoundingFace(px, py, isSlim) { const scale = SKIN_RES / 64; const faces = getSkinFaces(isSlim, scale); for (let f of faces) { if (px >= f[0] && px < f[0]+f[2] && py >= f[1] && py < f[1]+f[3]) return f; } return [0, 0, SKIN_RES, SKIN_RES]; }

const mirrorRegionsFull = [
    [8,8, 8,8, null,null, 'self', 2], [24,8, 8,8, null,null, 'self', 2], [8,0, 8,8, null,null, 'self', 2], [16,0, 8,8, null,null, 'self', 2], [0,8, 8,8, 16,8, 'other', 2], 
    [40,8, 8,8, null,null, 'self', 2], [56,8, 8,8, null,null, 'self', 2], [40,0, 8,8, null,null, 'self', 2], [48,0, 8,8, null,null, 'self', 2], [32,8, 8,8, 48,8, 'other', 2], 
    [20,20, 8,12, null,null, 'self', 2], [32,20, 8,12, null,null, 'self', 2], [20,16, 8,4, null,null, 'self', 2], [28,16, 8,4, null,null, 'self', 2], [16,20, 4,12, 28,20, 'other', 2], 
    [20,36, 8,12, null,null, 'self', 2], [32,36, 8,12, null,null, 'self', 2], [20,32, 8,4, null,null, 'self', 2], [28,32, 8,4, null,null, 'self', 2], [16,36, 4,12, 28,36, 'other', 2], 
    [4,20, 4,12, 20,52, 'other', 1], [12,20, 4,12, 28,52, 'other', 1], [4,16, 4,4, 20,48, 'other', 1], [8,16, 4,4, 24,48, 'other', 1], [0,20, 4,12, 24,52, 'other', 1], [8,20, 4,12, 16,52, 'other', 1], 
    [4,36, 4,12, 4,52, 'other', 1], [12,36, 4,12, 12,52, 'other', 1], [4,32, 4,4, 4,48, 'other', 1], [8,32, 4,4, 8,48, 'other', 1], [0,36, 4,12, 8,52, 'other', 1], [8,36, 4,12, 0,52, 'other', 1] 
];
const mirrorRegionsSteve = [
    [44,20, 4,12, 36,52, 'other', 1], [52,20, 4,12, 44,52, 'other', 1], [44,16, 4,4, 36,48, 'other', 1], [48,16, 4,4, 40,48, 'other', 1], [40,20, 4,12, 40,52, 'other', 1], [48,20, 4,12, 32,52, 'other', 1], 
    [44,36, 4,12, 52,52, 'other', 1], [52,36, 4,12, 60,52, 'other', 1], [44,32, 4,4, 52,48, 'other', 1], [48,32, 4,4, 56,48, 'other', 1], [40,36, 4,12, 56,52, 'other', 1], [48,36, 4,12, 48,52, 'other', 1] 
];
const mirrorRegionsAlex = [
    [44,20, 3,12, 36,52, 'other', 1], [51,20, 3,12, 43,52, 'other', 1], [44,16, 3,4, 36,48, 'other', 1], [47,16, 3,4, 39,48, 'other', 1], [40,20, 4,12, 39,52, 'other', 1], [47,20, 4,12, 32,52, 'other', 1], 
    [44,36, 3,12, 52,52, 'other', 1], [51,36, 3,12, 59,52, 'other', 1], [44,32, 3,4, 52,48, 'other', 1], [47,32, 3,4, 55,48, 'other', 1], [40,36, 4,12, 55,52, 'other', 1], [47,36, 4,12, 48,52, 'other', 1]
];

function getMirroredPixel(px, py) {
    if (mirrorMode === 0) return null; let regions = mirrorRegionsFull.concat(currentModel === 'slim' ? mirrorRegionsAlex : mirrorRegionsSteve); let s = SKIN_RES / 64;
    for (let r of regions) {
        let [sx, sy, w, h, dx, dy, type, reqMode] = r; if (mirrorMode < reqMode) continue;
        sx*=s; sy*=s; w*=s; h*=s; if(dx!==null) dx*=s; if(dy!==null) dy*=s;
        if (type === 'self' && px >= sx && px < sx + w && py >= sy && py < sy + h) return [sx + w - 1 - (px - sx), py];
        if (type === 'other') {
            if (px >= sx && px < sx + w && py >= sy && py < sy + h) return [dx + w - 1 - (px - sx), dy + (py - sy)];
            if (px >= dx && px < dx + w && py >= dy && py < dy + h) return [sx + w - 1 - (px - dx), sy + (py - dy)];
        }
    }
    return null;
}

function setLimbTint(group, hex) {
    [group.innerLayer, group.outerLayer].forEach(mesh => {
        if (mesh && mesh.material) { 
            
            // YENİ: Materyal daha önce bağımsız hale getirilmediyse, 
            // sadece bu uzva özel olması için onu klonluyoruz (kopyalıyoruz).
            // Bu sayede bir uzvun rengi değiştiğinde diğerleri etkilenmez.
            if (!mesh.userData.isIndependentMaterial) {
                if (Array.isArray(mesh.material)) {
                    mesh.material = mesh.material.map(m => m.clone());
                } else {
                    mesh.material = mesh.material.clone();
                }
                mesh.userData.isIndependentMaterial = true;
            }
            
            // Artık bağımsız olan materyalin rengini değiştiriyoruz
            if (Array.isArray(mesh.material)) { 
                mesh.material.forEach(m => { 
                    if (m.emissive) m.emissive.setHex(hex); 
                }); 
            } else { 
                if (mesh.material.emissive) {
                    mesh.material.emissive.setHex(hex); 
                }
            } 
        }
    });
}

let hoverAnimFrame = null;

function updateHoverAnimation() {
    if (!viewer3d || !viewer3d.playerObject || !viewer3d.playerObject.skin) return; 
    
    // Copy modu açıldığında animasyon döngüsünü başlat
    if (isCopyModeActive && !hoverAnimFrame) {
        animateHover();
    } 
    // Copy modu kapandığında animasyonu durdur ve her şeyi sıfırla
    else if (!isCopyModeActive && hoverAnimFrame) {
        cancelAnimationFrame(hoverAnimFrame);
        hoverAnimFrame = null;
        
        const skin = viewer3d.playerObject.skin;
        ['rightArm', 'leftArm', 'rightLeg', 'leftLeg'].forEach(limb => {
            if (skin[limb]) {
                skin[limb].scale.set(1, 1, 1);
                setLimbTint(skin[limb], 0xffffff);
            }
        });
    }
}

// Saniyede 60 kare çalışan güvenli matematiksel animasyon motoru
function animateHover() {
    if (!isCopyModeActive || !viewer3d) return;
    
    const time = Date.now() * 0.005;
    const pulse = Math.sin(time) * 0.5 + 0.5; // 0.0 ile 1.0 arası nefes alma efekti
    const skin = viewer3d.playerObject.skin;
    
    ['rightArm', 'leftArm', 'rightLeg', 'leftLeg'].forEach(limb => {
        if (skin[limb]) {
            let s = skin[limb].scale.x;
            
            if (hoveredLimbForCopy === limb) {
                // Seçili uzvu hedeflenen 1.08 boyutuna doğru yumuşakça (lerp) büyüt
                s += (1.08 - s) * 0.15; 
                skin[limb].scale.set(s, s, s);
                
                // Dinamik buz mavisi parlama efekti (Neon Pulse)
                const r = Math.floor(100 + pulse * 50);  
                const g = Math.floor(190 + pulse * 65);  
                const b = 255; 
                const hex = (r << 16) | (g << 8) | b;
                setLimbTint(skin[limb], hex);
            } else {
                // Seçili olmayan uzvu hedeflenen 1.0 boyutuna doğru yumuşakça küçült
                if (s > 1.001) {
                    s += (1.0 - s) * 0.2; 
                    skin[limb].scale.set(s, s, s);
                } else {
                    skin[limb].scale.set(1, 1, 1);
                }
                setLimbTint(skin[limb], 0xffffff);
            }
        }
    });
    
    // Sonraki kareyi çağır
    hoverAnimFrame = requestAnimationFrame(animateHover);
}

function copySpecificLimb(limbName) {
    const actCtx = typeof getActiveCtx === 'function' ? getActiveCtx() : ctx2d;
    const imgData = actCtx.getImageData(0,0,SKIN_RES,SKIN_RES); 
    const data = imgData.data; 
    const isSlim = currentModel === 'slim'; 
    let regions = []; let reverse = false; let s = SKIN_RES / 64;
    
    if (limbName === 'rightLeg') { regions = mirrorRegionsFull.slice(20, 32); reverse = false; } 
    else if (limbName === 'leftLeg') { regions = mirrorRegionsFull.slice(20, 32); reverse = true; } 
    else if (limbName === 'rightArm') { regions = isSlim ? mirrorRegionsAlex : mirrorRegionsSteve; reverse = false; } 
    else if (limbName === 'leftArm') { regions = isSlim ? mirrorRegionsAlex : mirrorRegionsSteve; reverse = true; } 
    else return; 
    
    regions.forEach(r => {
        let [sx, sy, w, h, dx, dy, type, reqMode] = r; sx*=s; sy*=s; w*=s; h*=s; if(dx!==null) dx*=s; if(dy!==null) dy*=s;
        if (type === 'other') {
            for(let y=0; y<h; y++) {
                for(let x=0; x<w; x++) {
                    let srcIdx, dstIdx;
                    if (!reverse) { srcIdx = ((sy + y) * SKIN_RES + (sx + x)) * 4; dstIdx = ((dy + y) * SKIN_RES + (dx + w - 1 - x)) * 4; } 
                    else { srcIdx = ((dy + y) * SKIN_RES + (dx + w - 1 - x)) * 4; dstIdx = ((sy + y) * SKIN_RES + (sx + x)) * 4; }
                    data[dstIdx] = data[srcIdx]; data[dstIdx+1] = data[srcIdx+1]; data[dstIdx+2] = data[srcIdx+2]; data[dstIdx+3] = data[srcIdx+3];
                }
            }
        }
    });
    
    actCtx.putImageData(imgData, 0, 0); 
    if(typeof renderComposite === 'function') renderComposite();
    if(typeof saveHistory === 'function') saveHistory();
}

function disableCopyMode() {
    isCopyModeActive = false; hoveredLimbForCopy = null; updateHoverAnimation();
    const btn = document.getElementById('btn-action-mirror');
    if (btn) { btn.classList.remove('active', 'waiting'); btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-8"/><path d="M16 21h5v-5"/><path d="M8 21H3v-5"/><path d="M21 3l-6 6"/><path d="M3 3l6 6"/><path d="M21 21l-6-6"/><path d="M3 21l6-6"/></svg><span>Copy Limb</span>`; }
    canvas3d.style.cursor = 'default';
}

document.getElementById('btn-action-mirror').addEventListener('click', function() {
    if (isCopyModeActive) { disableCopyMode(); } 
    else { isCopyModeActive = true; this.classList.add('active', 'waiting'); this.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><span>Select a Limb...</span>`; }
});

function sVertL(ctx, i, fX, fY, fW, fH, dX, dY, dW, dH, s) { ctx.imageSmoothingEnabled = false; ctx.clearRect(dX*s, dY*s, dW*s, dH*s); ctx.drawImage(i, fX*s, fY*s, 1, fH*s, dX*s, dY*s, dW*s, dH*s); }
function sVertR(ctx, i, fX, fY, fW, fH, dX, dY, dW, dH, s) { ctx.imageSmoothingEnabled = false; ctx.clearRect(dX*s, dY*s, dW*s, dH*s); ctx.drawImage(i, (fX+fW)*s-1, fY*s, 1, fH*s, dX*s, dY*s, dW*s, dH*s); }
function sHorzT(ctx, i, fX, fY, fW, fH, dX, dY, dW, dH, s) { ctx.imageSmoothingEnabled = false; ctx.clearRect(dX*s, dY*s, dW*s, dH*s); ctx.drawImage(i, fX*s, fY*s, fW*s, 1, dX*s, dY*s, dW*s, dH*s); }
function sHorzB(ctx, i, fX, fY, fW, fH, dX, dY, dW, dH, s) { ctx.imageSmoothingEnabled = false; ctx.clearRect(dX*s, dY*s, dW*s, dH*s); ctx.drawImage(i, fX*s, (fY+fH)*s-1, fW*s, 1, dX*s, dY*s, dW*s, dH*s); }
function copyMirr(ctx, i, sx, sy, sw, sh, dx, dy, dw, dh, s) { ctx.imageSmoothingEnabled = false; ctx.clearRect(dx*s, dy*s, dw*s, dh*s); ctx.save(); ctx.imageSmoothingEnabled = false; ctx.translate((dx+dw)*s, dy*s); ctx.scale(-1, 1); ctx.drawImage(i, sx*s, sy*s, sw*s, sh*s, 0, 0, dw*s, dh*s); ctx.restore(); }

function wrapPart(ctx, img, p, s) {
    const f = p.front;
    sVertL(ctx, img, f.x, f.y, f.w, f.h, p.left.x, p.left.y, p.left.w, p.left.h, s);
    sVertR(ctx, img, f.x, f.y, f.w, f.h, p.right.x, p.right.y, p.right.w, p.right.h, s);
    copyMirr(ctx, img, f.x, f.y, f.w, f.h, p.back.x, p.back.y, p.back.w, p.back.h, s);
    sHorzT(ctx, img, f.x, f.y, f.w, f.h, p.top.x, p.top.y, p.top.w, p.top.h, s);
    sHorzB(ctx, img, f.x, f.y, f.w, f.h, p.bottom.x, p.bottom.y, p.bottom.w, p.bottom.h, s);
}

function runAutoFill() {
    const isAlex = currentModel === 'slim';
    const actCtx = typeof getActiveCtx === 'function' ? getActiveCtx() : ctx2d;
    const tempCanvas = document.createElement('canvas'); 
    tempCanvas.width = SKIN_RES; tempCanvas.height = SKIN_RES; 
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.imageSmoothingEnabled = false; actCtx.imageSmoothingEnabled = false; 
    
    tempCtx.drawImage(actCtx.canvas, 0, 0); 
    const s = SKIN_RES / 64;

    wrapPart(actCtx, tempCanvas, {front:{x:20,y:20,w:8,h:12}, left:{x:16,y:20,w:4,h:12}, right:{x:28,y:20,w:4,h:12}, back:{x:32,y:20,w:8,h:12}, top:{x:20,y:16,w:8,h:4}, bottom:{x:28,y:16,w:8,h:4}}, s);
    wrapPart(actCtx, tempCanvas, {front:{x:4,y:20,w:4,h:12}, left:{x:0,y:20,w:4,h:12}, right:{x:8,y:20,w:4,h:12}, back:{x:12,y:20,w:4,h:12}, top:{x:4,y:16,w:4,h:4}, bottom:{x:8,y:16,w:4,h:4}}, s);
    wrapPart(actCtx, tempCanvas, {front:{x:20,y:52,w:4,h:12}, left:{x:16,y:52,w:4,h:12}, right:{x:24,y:52,w:4,h:12}, back:{x:28,y:52,w:4,h:12}, top:{x:20,y:48,w:4,h:4}, bottom:{x:24,y:48,w:4,h:4}}, s);
    wrapPart(actCtx, tempCanvas, {front:{x:4,y:52,w:4,h:12}, left:{x:0,y:52,w:4,h:12}, right:{x:8,y:52,w:4,h:12}, back:{x:12,y:52,w:4,h:12}, top:{x:4,y:48,w:4,h:4}, bottom:{x:8,y:48,w:4,h:4}}, s);
    wrapPart(actCtx, tempCanvas, {front:{x:20,y:36,w:8,h:12}, left:{x:16,y:36,w:4,h:12}, right:{x:28,y:36,w:4,h:12}, back:{x:32,y:36,w:8,h:12}, top:{x:20,y:32,w:8,h:4}, bottom:{x:28,y:32,w:8,h:4}}, s);
    wrapPart(actCtx, tempCanvas, {front:{x:4,y:36,w:4,h:12}, left:{x:0,y:36,w:4,h:12}, right:{x:8,y:36,w:4,h:12}, back:{x:12,y:36,w:4,h:12}, top:{x:4,y:32,w:4,h:4}, bottom:{x:8,y:32,w:4,h:4}}, s);
    wrapPart(actCtx, tempCanvas, {front:{x:20,y:52,w:4,h:12}, left:{x:16,y:52,w:4,h:12}, right:{x:24,y:52,w:4,h:12}, back:{x:28,y:52,w:4,h:12}, top:{x:20,y:48,w:4,h:4}, bottom:{x:24,y:48,w:4,h:4}}, s);
    wrapPart(actCtx, tempCanvas, {front:{x:4,y:52,w:4,h:12}, left:{x:0,y:52,w:4,h:12}, right:{x:8,y:52,w:4,h:12}, back:{x:12,y:52,w:4,h:12}, top:{x:4,y:48,w:4,h:4}, bottom:{x:8,y:48,w:4,h:4}}, s);
    
    if(!isAlex) {
        wrapPart(actCtx, tempCanvas, {front:{x:44,y:20,w:4,h:12}, left:{x:40,y:20,w:4,h:12}, right:{x:48,y:20,w:4,h:12}, back:{x:52,y:20,w:4,h:12}, top:{x:44,y:16,w:4,h:4}, bottom:{x:48,y:16,w:4,h:4}}, s);
        wrapPart(actCtx, tempCanvas, {front:{x:44,y:36,w:4,h:12}, left:{x:40,y:36,w:4,h:12}, right:{x:48,y:36,w:4,h:12}, back:{x:52,y:36,w:4,h:12}, top:{x:44,y:32,w:4,h:4}, bottom:{x:48,y:32,w:4,h:4}}, s);
        wrapPart(actCtx, tempCanvas, {front:{x:36,y:52,w:4,h:12}, left:{x:32,y:52,w:4,h:12}, right:{x:40,y:52,w:4,h:12}, back:{x:44,y:52,w:4,h:12}, top:{x:36,y:48,w:4,h:4}, bottom:{x:40,y:48,w:4,h:4}}, s);
        wrapPart(actCtx, tempCanvas, {front:{x:52,y:52,w:4,h:12}, left:{x:48,y:52,w:4,h:12}, right:{x:56,y:52,w:4,h:12}, back:{x:60,y:52,w:4,h:12}, top:{x:52,y:48,w:4,h:4}, bottom:{x:56,y:48,w:4,h:4}}, s);
    } else {
        wrapPart(actCtx, tempCanvas, {front:{x:44,y:20,w:3,h:12}, left:{x:40,y:20,w:4,h:12}, right:{x:47,y:20,w:4,h:12}, back:{x:51,y:20,w:3,h:12}, top:{x:44,y:16,w:3,h:4}, bottom:{x:47,y:16,w:3,h:4}}, s);
        wrapPart(actCtx, tempCanvas, {front:{x:44,y:36,w:3,h:12}, left:{x:40,y:36,w:4,h:12}, right:{x:47,y:36,w:4,h:12}, back:{x:51,y:36,w:3,h:12}, top:{x:44,y:32,w:3,h:4}, bottom:{x:47,y:32,w:3,h:4}}, s);
        wrapPart(actCtx, tempCanvas, {front:{x:36,y:52,w:3,h:12}, left:{x:32,y:52,w:4,h:12}, right:{x:39,y:52,w:4,h:12}, back:{x:43,y:52,w:3,h:12}, top:{x:36,y:48,w:3,h:4}, bottom:{x:39,y:48,w:3,h:4}}, s);
        wrapPart(actCtx, tempCanvas, {front:{x:52,y:52,w:3,h:12}, left:{x:48,y:52,w:4,h:12}, right:{x:55,y:52,w:4,h:12}, back:{x:59,y:52,w:3,h:12}, top:{x:52,y:48,w:3,h:4}, bottom:{x:55,y:48,w:3,h:4}}, s);
    }
    
    if(typeof renderComposite === 'function') renderComposite();
    if(typeof saveHistory === 'function') setTimeout(saveHistory, 50);
}

const autoFillModal = document.getElementById('modal-autofill-confirm');
document.getElementById('btn-action-filler').addEventListener('click', () => {
    autoFillModal.style.display = 'flex';
});
document.getElementById('btn-autofill-cancel').addEventListener('click', () => {
    autoFillModal.style.display = 'none';
});
document.getElementById('btn-autofill-confirm').addEventListener('click', () => {
    autoFillModal.style.display = 'none';
    runAutoFill();
});
autoFillModal.addEventListener('click', (event) => {
    if (event.target === autoFillModal) autoFillModal.style.display = 'none';
});

document.getElementById('btn-action-guide').addEventListener('click', () => {
    is2DGuideVisible = !is2DGuideVisible;
    draw2DGuide();
    document.getElementById('editor-2d-guide').style.display = is2DGuideVisible ? 'block' : 'none';
    updateMenuStates();
    const guideBtn = document.getElementById('btn-action-guide');
    if (guideBtn) {
        if (is2DGuideVisible) guideBtn.classList.add('active');
        else guideBtn.classList.remove('active');
    }
});

function getIntersects(e) {
    const rect = canvas3d.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1; 
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, viewer3d.camera);
    
    let hits = raycaster.intersectObject(viewer3d.playerObject, true).filter(hit => {
        if (!isMeshVisible(hit.object)) return false;
        if (hit.face) {
            const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
            const worldNormal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
            if (worldNormal.dot(raycaster.ray.direction) > 0) return false; 
        }
        return true;
    });

    if (hits.length === 0) return [];
    if (!window.cachedImageData) window.cachedImageData = ctx2d.getImageData(0,0,SKIN_RES,SKIN_RES).data;
    const data = window.cachedImageData;

    let firstOpaqueHit = null; let opaqueHitIndex = -1;
    for (let i = 0; i < hits.length; i++) {
        const hit = hits[i];
        if (hit.uv) {
            const px = Math.max(0, Math.min(SKIN_RES - 1, Math.floor(hit.uv.x * SKIN_RES))); 
            const py = Math.max(0, Math.min(SKIN_RES - 1, Math.floor((1 - hit.uv.y) * SKIN_RES)));
            const alpha = data[(py * SKIN_RES + px) * 4 + 3];
            if (alpha > 0) { firstOpaqueHit = hit; opaqueHitIndex = i; break; }
        }
    }
    if (firstOpaqueHit) {
        const targetBodyPart = firstOpaqueHit.object.parent; 
        for (let i = 0; i < opaqueHitIndex; i++) { if (hits[i].object.parent === targetBodyPart) return [hits[i]]; }
        return [firstOpaqueHit];
    }
    return [hits[0]];
}

// Renk seçicide dış 3D katman saydam ise ray, alttaki katmana da çarpar.
// Çizim aracı için kullanılan özel isabet mantığı saydam yüzeyi geri
// döndürebilir; renk seçici ise doğrudan ilk opak doku pikselini bulmalıdır.
function getColorPickerIntersect(e) {
    const rect = canvas3d.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, viewer3d.camera);

    const hits = raycaster.intersectObject(viewer3d.playerObject, true).filter(hit => {
        if (!isMeshVisible(hit.object)) return false;
        if (!hit.face) return true;
        const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
        const worldNormal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
        return worldNormal.dot(raycaster.ray.direction) <= 0;
    });

    if (!hits.length) return null;
    const textureData = ctx2d.getImageData(0, 0, SKIN_RES, SKIN_RES).data;
    for (const hit of hits) {
        if (!hit.uv) continue;
        const px = Math.max(0, Math.min(SKIN_RES - 1, Math.floor(hit.uv.x * SKIN_RES)));
        const py = Math.max(0, Math.min(SKIN_RES - 1, Math.floor((1 - hit.uv.y) * SKIN_RES)));
        if (textureData[(py * SKIN_RES + px) * 4 + 3] > 0) return hit;
    }
    return null;
}

let last3DObject = null;
let last3DNormal = null;

function drawOn3D(intersects, e = null) {
    if (!intersects || intersects.length === 0) return;
    const hit = intersects[0];
    const uv = hit.uv; if (!uv) return;
    const px = Math.max(0, Math.min(SKIN_RES - 1, Math.floor(uv.x * SKIN_RES))); 
    const py = Math.max(0, Math.min(SKIN_RES - 1, Math.floor((1 - uv.y) * SKIN_RES)));
    
    // Hangi uzvun (sağ kol, gövde vb.) ve hangi yüzeyin (ön, arka vb.) üzerinde olduğumuzu bul
    const currentObject = hit.object;
    let currentNormal = null;
    if (hit.face && hit.face.normal) currentNormal = hit.face.normal.clone().round();

    // UV Atlamalarını (Uzuv veya Yüzey değişimini) Tespit Et
    if (lastDrawX !== null && lastDrawY !== null) {
        let isJump = false;
        
        // 1. Farklı bir uzva geçildiyse (Örn: Gövdeden Kola)
        if (last3DObject !== currentObject) isJump = true;
        // 2. Aynı uzuvda farklı bir yüze dönüldüyse (Örn: Önden Yana)
        if (last3DNormal && currentNormal && !last3DNormal.equals(currentNormal)) isJump = true;
        // 3. İmkansız 2D Atlaması (UV Adaları Arası Boşluklar > 10 piksel ise)
        const dx = px - lastDrawX;
        const dy = py - lastDrawY;
        if (Math.sqrt(dx*dx + dy*dy) > 10) isJump = true;

        // Eğer bir atlama olduysa, fırçanın arayı birleştirmesini (uzun çizgi çekmesini) engelle
        if (isJump) {
            lastDrawX = null;
            lastDrawY = null;
            
            // Max Alpha (Yumuşak Fırça) hafızasını da güvenli şekilde yenile
            if (typeof isRoundBrushMode !== 'undefined' && isRoundBrushMode) {
                const actCtx = getActiveCtx();
                if (typeof strokeOriginalData !== 'undefined') strokeOriginalData = actCtx.getImageData(0, 0, SKIN_RES, SKIN_RES);
                if (typeof strokeAlphaMap !== 'undefined') strokeAlphaMap = new Float32Array(SKIN_RES * SKIN_RES);
                if (typeof strokeDirtyBox !== 'undefined') strokeDirtyBox = { minX: SKIN_RES, minY: SKIN_RES, maxX: -1, maxY: -1 };
            }
        }
    }

    last3DObject = currentObject;
    last3DNormal = currentNormal;

    if(typeof applyBrush === 'function') {
        applyBrush(px, py, e);
    }
}

canvas3d.addEventListener('mousemove', (e) => {
    // Sağ tuş her araçta 3D görünümü döndürür; çizim veya renk alma başlatmaz.
    if ((e.buttons & 2) && !isDrawing) {
        isRotating = true;
        isPanning = false;
        viewer3d.controls.enableRotate = true;
        canvas3d.style.cursor = 'grabbing';
        return;
    }

    const intersects = getIntersects(e);
    const isHoveringModel = intersects.length > 0;
    
    if (isCopyModeActive) {
        let newHover = null;
        if (isHoveringModel) {
            const obj = intersects[0].object; const skin = viewer3d.playerObject.skin;
            if (obj.parent === skin.rightArm || obj === skin.rightArm.innerLayer || obj === skin.rightArm.outerLayer) newHover = 'rightArm';
            else if (obj.parent === skin.leftArm || obj === skin.leftArm.innerLayer || obj === skin.leftArm.outerLayer) newHover = 'leftArm';
            else if (obj.parent === skin.rightLeg || obj === skin.rightLeg.innerLayer || obj === skin.rightLeg.outerLayer) newHover = 'rightLeg';
            else if (obj.parent === skin.leftLeg || obj === skin.leftLeg.innerLayer || obj === skin.leftLeg.outerLayer) newHover = 'leftLeg';
        }
        if (newHover !== hoveredLimbForCopy) { hoveredLimbForCopy = newHover; updateHoverAnimation(); }
        canvas3d.style.cursor = newHover ? 'pointer' : 'default';
        return;
    }

    if (!isDrawing && !isRotating && !isPanning) {
        if (isHoveringModel) {
            viewer3d.controls.enableRotate = false;
            if (activeTool === 'picker') canvas3d.style.cursor = 'crosshair';
            else if (isRoundBrushMode) canvas3d.style.cursor = currentBrushCursorUrl; // Dinamik Yuvarlak İmleç
            else if (activeTool === 'eraser') canvas3d.style.cursor = 'crosshair';
            else canvas3d.style.cursor = 'crosshair';
        } else { viewer3d.controls.enableRotate = true; canvas3d.style.cursor = 'grab'; }
    }
    
    // Kova seçiliyken activeTool kalem olabilir; bu yüzden sürükleme durumunu
    // doğrudan isBucketMode üzerinden ele alıyoruz.
    if (isDrawing && isBucketMode && e.buttons !== 0) {
        if (intersects.length > 0) drawOn3D(intersects, e);
        return;
    }
    if (isDrawing) {
        const isPickingColor = activeTool === 'picker' || e.altKey;
        const pickerHit = isPickingColor ? getColorPickerIntersect(e) : null;
        if (pickerHit) {
            drawOn3D([pickerHit], e);
        } else if (!isPickingColor && intersects.length > 0) {
            drawOn3D(intersects, e);
        }
    }
});

canvas3d.addEventListener('mousedown', (e) => {
    if (e.button === 2) {
        // Kalem modelin üzerindeyken sağ tuş ikinci renkle boyamayı sürdürür.
        // Modelin dışında ise aynı sağ tuş kamera döndürme davranışını korur.
        const canRightPaint = activeTool === 'brush' && !isRoundBrushMode && !isBucketMode;
        const rightHits = canRightPaint ? getIntersects(e) : [];
        if (rightHits.length > 0) {
            isDrawing = true;
            strokePixels.clear();
            viewer3d.controls.enableRotate = false;
            drawOn3D(rightHits, e);
            return;
        }
        isDrawing = false;
        isPanning = false;
        isRotating = true;
        viewer3d.controls.enableRotate = true;
        canvas3d.style.cursor = 'grabbing';
        return;
    } else if (e.button !== 0) {
        return; 
    }

    const isPickingColor = activeTool === 'picker' || e.altKey;
    const pickerHit = isPickingColor ? getColorPickerIntersect(e) : null;
    const intersects = isPickingColor ? (pickerHit ? [pickerHit] : []) : getIntersects(e);
    
    if (isCopyModeActive) {
        if (hoveredLimbForCopy) { copySpecificLimb(hoveredLimbForCopy); disableCopyMode(); }
        return;
    }
    
    if (intersects.length > 0) {
        isDrawing = true; strokePixels.clear(); viewer3d.controls.enableRotate = false;
        drawOn3D(intersects, e); 
    }
    else { isRotating = true; viewer3d.controls.enableRotate = true; canvas3d.style.cursor = 'grabbing'; }
});

// SADECE 3D MOTORU İÇİN (2D ve 3D'nin çakışmasını engellemek amacıyla is2DMode kontrolü)
window.addEventListener('mouseup', (e) => {
    // YENİ: 3D ekranda çizim yapıldıysa hem history'e (Ctrl+Z) hem de renk geçmişine ekle
    if (isDrawing && hasDrawnStroke) {
        if (typeof saveHistory === 'function') saveHistory();
        if (typeof addToColorHistory === 'function') addToColorHistory();
    }

    // Çizim bayraklarını koşulsuz olarak temizle
    isDrawing = false; 
    isRotating = false; 
    isPanning = false;
    hasDrawnStroke = false; 
    lastDrawX = null; 
    lastDrawY = null; 
    last3DObject = null;
    last3DNormal = null;
    strokeOriginalData = null;
    strokeAlphaMap = null;
    strokeDirtyBox = null;

    if (!isCopyModeActive && canvas3d && canvas3d.style.display !== 'none') {
        // Fare hareketi beklemeden, çizim aracının imlecini koru. Önceden
        // burada "default" atanması tıkladıktan sonra imlecin anlık kaybolmasına
        // neden oluyordu.
        const usesDrawingCursor = isBucketMode || ['picker', 'brush', 'eraser'].includes(activeTool);
        canvas3d.style.cursor = usesDrawingCursor ? (isRoundBrushMode ? currentBrushCursorUrl : 'crosshair') : 'default';
    }
});

canvas3d.addEventListener('mouseleave', () => {
    if (isDrawing && hasDrawnStroke) { 
        if(typeof saveHistory === 'function') saveHistory(); 
        addToColorHistory(); 
    }
    isDrawing = false; isRotating = false; isPanning = false; hasDrawnStroke = false;
    // FIRÇA ÇİZGİSİNİ, HAFIZASINI VE 3D GEÇMİŞİNİ SIFIRLAMA
    lastDrawX = null; 
    lastDrawY = null; 
    if (typeof strokeOriginalData !== 'undefined') strokeOriginalData = null;
    if (typeof strokeAlphaMap !== 'undefined') strokeAlphaMap = null;
    if (typeof strokeDirtyBox !== 'undefined') strokeDirtyBox = null;
    
    last3DObject = null;
    last3DNormal = null;
    
    if(isCopyModeActive) { hoveredLimbForCopy = null; updateHoverAnimation(); }
});

// === KLAVYE KISAYOLLARI MENÜSÜNÜ AÇMA VE LİSTEYİ DOLDURMA ===
document.getElementById('menu-settings-shortcuts').addEventListener('click', () => {
    closeAllMenus();
    
    const container = document.getElementById('shortcuts-container');
    if (!container) return;
    
    container.innerHTML = ''; // Eski listeyi temizle
    
    // Araç isimleri ve simgeleri, araç çubuğundaki karşılıklarıyla birebir aynıdır.
    const toolNames = { 
        brush: 'Pencil',
        round_brush: 'Round Brush',
        bucket: 'Paint Bucket',
        eraser: 'Eraser',
        picker: 'Color Picker',
        rect_select: 'Rectangle Select',
        magic_wand: 'Magic Wand',
        transform: 'Move Selection',
        swap: 'Swap Colors',
        mirror: 'Mirror (Toggle)',
        grid: 'Grid (Toggle)'
    };
    const iconSources = { brush: '#tool-brush', round_brush: '#tool-round_brush', bucket: '#tool-bucket', eraser: '#tool-eraser', picker: '#tool-picker', rect_select: '#tool-rect_select', magic_wand: '#tool-magic_wand', transform: '#tool-transform', swap: '#swap-colors', mirror: '#btn-action-mirror', grid: '#tool-grid' };
    const getToolbarIcon = (key) => document.querySelector(iconSources[key])?.querySelector('svg')?.outerHTML || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="7"/></svg>';
    
    // Her bir kısayol için listeye yeni bir eleman oluştur
    for (let key in toolShortcuts) {
        const item = document.createElement('div');
        item.className = 'shortcut-item';
        
        item.innerHTML = `
            <span class="shortcut-tool">${getToolbarIcon(key)}<span>${toolNames[key] || key}</span></span>
            <button class="shortcut-key-btn" data-key="${key}">${toolShortcuts[key].toUpperCase()}</button>
        `;
        
        // Kısayol değiştirme butonuna tıklandığında dinleme moduna geç
        const btn = item.querySelector('.shortcut-key-btn');
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Diğer butonların dinleme modunu kapat
            container.querySelectorAll('.shortcut-key-btn').forEach(b => {
                b.classList.remove('listening');
                b.innerText = toolShortcuts[b.getAttribute('data-key')].toUpperCase();
            });
            
            // Tıklanan butonu dinleme moduna al
            btn.classList.add('listening');
            btn.innerText = '...';
            isListeningForKey = true;
            currentKeyTarget = key;
        });
        
        container.appendChild(item);
    }
    
    // Modalı ekranda göster
    document.getElementById('modal-shortcuts').style.display = 'flex';
});
