// ==========================================================================
// === APP.JS (Katmanlar, Seçim Mantığı, Kısayollar, Adjustments, Transform) ===
// ==========================================================================

// === DOSYA (DOCUMENT) YÖNETİCİSİ DEĞİŞKENLERİ ===
let documents = [];
let activeDocIndex = -1;
let docIdCounter = 1;
let draggedDocIndex = null;

let isLatestCopyInternal = false;
const PREFERENCES_STORAGE_KEY = 'cardors-skin-editor.preferences.v1';
let preferencesReady = false;
let preferencesSaveTimer = null;
// Kullanıcı farklı bir sekmeye veya programa geçerse iç hafıza kilidini aç
window.addEventListener('blur', () => { isLatestCopyInternal = false; });

function schedulePreferencesSave() {
    if (!preferencesReady) return;
    clearTimeout(preferencesSaveTimer);
    preferencesSaveTimer = setTimeout(savePersistentPreferences, 500);
}

function getPersistedPanelStates() {
    return ['window-toolbar', 'window-color-panel', 'window-layers-panel'].reduce((states, id) => {
        const panel = document.getElementById(id);
        if (!panel) return states;
        const rect = panel.getBoundingClientRect();
        states[id] = {
            top: Math.round(rect.top), left: Math.round(rect.left),
            visible: window.getComputedStyle(panel).display !== 'none'
        };
        return states;
    }, {});
}

function getLastSkinSnapshot() {
    if (!layers || layers.length === 0) return null;
    return {
        name: (documents[activeDocIndex] && documents[activeDocIndex].name) || 'Son Skin',
        skinRes: SKIN_RES,
        model: currentModel,
        activeLayerIndex,
        layers: layers.map(layer => ({
            id: layer.id, name: layer.name, opacity: layer.opacity,
            blendMode: layer.blendMode, visible: layer.visible,
            image: layer.canvas.toDataURL('image/png')
        }))
    };
}

function savePersistentPreferences() {
    if (!preferencesReady) return;
    try {
        const preferences = {
            backgroundColor: bgPicker.value,
            shortcuts: toolShortcuts,
            colors: {
                primary: { r: currentR, g: currentG, b: currentB, h: currentH, s: currentS, l: currentL, a: currentA },
                secondary: secondaryColor,
                history: colorHistory
            },
            panels: getPersistedPanelStates(),
            lastSkin: getLastSkinSnapshot()
        };
        localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
    } catch (error) {
        // Depolama alanı doluysa editör çalışmaya devam eder; yalnızca kayıt atlanır.
        console.warn('Tercihler kaydedilemedi:', error);
    }
}

function restorePanelStates(panelStates) {
    if (!panelStates) return;
    Object.entries(panelStates).forEach(([id, state]) => {
        const panel = document.getElementById(id);
        if (!panel || !Number.isFinite(state.top) || !Number.isFinite(state.left)) return;
        panel.style.top = `${state.top}px`;
        panel.style.left = `${state.left}px`;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        panel.style.transform = 'none';
        panel.style.display = state.visible === false ? 'none' : 'flex';
    });
}

async function restoreLastSkinSnapshot(snapshot) {
    if (!snapshot || ![64, 128].includes(snapshot.skinRes) || !Array.isArray(snapshot.layers) || !snapshot.layers.length) return false;
    SKIN_RES = snapshot.skinRes;
    canvas2d.width = SKIN_RES; canvas2d.height = SKIN_RES;
    ctx2d.imageSmoothingEnabled = false;
    window.cachedImageData = null;

    const restoredLayers = snapshot.layers.map((savedLayer, index) => {
        const canvas = document.createElement('canvas');
        canvas.width = SKIN_RES; canvas.height = SKIN_RES;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingEnabled = false;
        return {
            id: Number.isInteger(savedLayer.id) ? savedLayer.id : index,
            name: savedLayer.name || `Layer ${index + 1}`,
            canvas, ctx,
            opacity: Number.isFinite(savedLayer.opacity) ? savedLayer.opacity : 255,
            blendMode: savedLayer.blendMode || 'source-over',
            visible: savedLayer.visible !== false,
            image: savedLayer.image
        };
    });

    await Promise.all(restoredLayers.map(layer => new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => { layer.ctx.drawImage(image, 0, 0, SKIN_RES, SKIN_RES); delete layer.image; resolve(); };
        image.onerror = reject;
        image.src = layer.image;
    })));

    layers = restoredLayers;
    activeLayerIndex = Math.max(0, Math.min(restoredLayers.length - 1, snapshot.activeLayerIndex || 0));
    layerIdCounter = Math.max(...restoredLayers.map(layer => layer.id), 0) + 1;
    historyData = []; historyStep = -1;
    currentModel = snapshot.model === 'slim' ? 'slim' : 'default';
    documents = [{ id: 1, name: snapshot.name || 'Son Skin', layers, activeLayerIndex, layerIdCounter, historyData, historyStep, skinRes: SKIN_RES, currentModel, thumbnail: '' }];
    docIdCounter = 2;
    activeDocIndex = 0;
    selectionMask = new Uint8Array(SKIN_RES * SKIN_RES);
    hasSelection = false;
    updateLayerUI();
    renderComposite();
    await applyLiveTexture(currentModel);
    updateDocumentTabsUI();
    saveHistory();
    return true;
}

async function restorePersistentPreferences() {
    let preferences;
    try {
        preferences = JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY) || 'null');
    } catch (error) { return false; }
    if (!preferences) return false;

    if (typeof preferences.backgroundColor === 'string') bgPicker.value = preferences.backgroundColor;
    if (preferences.shortcuts && typeof preferences.shortcuts === 'object') {
        Object.keys(toolShortcuts).forEach(key => {
            if (typeof preferences.shortcuts[key] === 'string' && preferences.shortcuts[key]) toolShortcuts[key] = preferences.shortcuts[key];
        });
    }
    const colors = preferences.colors;
    if (colors && colors.primary) {
        const primary = colors.primary;
        if ([primary.r, primary.g, primary.b, primary.h, primary.s, primary.l, primary.a].every(Number.isFinite)) {
            currentR = primary.r; currentG = primary.g; currentB = primary.b;
            currentH = primary.h; currentS = primary.s; currentL = primary.l; currentA = primary.a;
        }
        if (colors.secondary && [colors.secondary.h, colors.secondary.s, colors.secondary.l, colors.secondary.a].every(Number.isFinite)) secondaryColor = colors.secondary;
        if (Array.isArray(colors.history)) colorHistory = colors.history.slice(0, 14);
    }
    restorePanelStates(preferences.panels);
    const restoredSkin = await restoreLastSkinSnapshot(preferences.lastSkin).catch(() => false);
    updateToolTitles();
    updateUIColors();
    renderColorHistory();
    updateMenuStates();
    return restoredSkin;
}

window.addEventListener('beforeunload', () => {
    if (preferencesSaveTimer) clearTimeout(preferencesSaveTimer);
    savePersistentPreferences();
});

// Mevcut belgenin son durumunu hafızaya kaydeder
function saveCurrentDocumentState() {
    if (activeDocIndex < 0 || !documents[activeDocIndex]) return;
    documents[activeDocIndex].layers = layers;
    documents[activeDocIndex].activeLayerIndex = activeLayerIndex;
    documents[activeDocIndex].layerIdCounter = layerIdCounter;
    documents[activeDocIndex].historyData = historyData;
    documents[activeDocIndex].historyStep = historyStep;
    documents[activeDocIndex].skinRes = SKIN_RES;
    documents[activeDocIndex].currentModel = currentModel;
    documents[activeDocIndex].thumbnail = canvas2d.toDataURL();
    schedulePreferencesSave();
}

// Seçili belgeyi hafızadan ekrana ve motorlara yükler
function loadDocumentState(index) {
    if (index < 0 || index >= documents.length) return;
    activeDocIndex = index;
    const doc = documents[index];

    layers = doc.layers;
    activeLayerIndex = doc.activeLayerIndex;
    layerIdCounter = doc.layerIdCounter;
    historyData = doc.historyData;
    historyStep = doc.historyStep;
    currentModel = doc.currentModel;

    // Çözünürlük değiştiyse canvasları güncelle
    if (SKIN_RES !== doc.skinRes) {
        SKIN_RES = doc.skinRes;
        canvas2d.width = SKIN_RES;
        canvas2d.height = SKIN_RES;
        window.cachedImageData = null;
    }

    // Seçimleri temizle (Dosyalar arası geçerken seçim çerçevesi hata yapmasın diye)
    selectionMask = new Uint8Array(SKIN_RES * SKIN_RES);
    hasSelection = false;
    rectSelData = null;
    if (typeof updateSelectionVisuals === 'function') updateSelectionVisuals();

    updateLayerUI();
    renderComposite();
    applyLiveTexture(currentModel);
    updateDocumentTabsUI();
}

// Yeni Bir Dosya / Belge Oluşturur
function createNewDocument(name, img = null, res = 64, model = 'default') {
    saveCurrentDocumentState();

    const initialLayers = [];
    const canvas = document.createElement('canvas');
    canvas.width = res; canvas.height = res;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;

    if (img) {
        ctx.drawImage(img, 0, 0, res, res);
    } else {
        drawTemplateFallback(ctx);
    }

    initialLayers.push({ id: 0, name: "Background", canvas: canvas, ctx: ctx, opacity: 255, blendMode: 'source-over', visible: true });

    const newDoc = {
        id: docIdCounter++,
        name: name,
        layers: initialLayers,
        activeLayerIndex: 0,
        layerIdCounter: 1,
        historyData: [],
        historyStep: -1,
        skinRes: res,
        currentModel: model,
        thumbnail: canvas.toDataURL()
    };

    // Aktif sekmenin hemen sağına yeni dosyayı ekler
    if (activeDocIndex >= 0) {
        documents.splice(activeDocIndex + 1, 0, newDoc);
        activeDocIndex++;
    } else {
        documents.push(newDoc);
        activeDocIndex = 0;
    }

    loadDocumentState(activeDocIndex);
    // YENİ EKLENDİ: İlk boş hali geçmişe kaydet ki ilk işlem geri alınabilsin
    saveHistory();
    saveCurrentDocumentState();
}

// Dosya (Sekme) Arayüzünü Çizer ve Sürükle-Bırak Olaylarını Yönetir
// Dosya (Sekme) Arayüzünü Çizer ve Sürükle-Bırak Olaylarını Yönetir
function updateDocumentTabsUI() {
    const container = document.getElementById('document-tabs-container');
    if (!container) return;
    container.innerHTML = '';

    documents.forEach((doc, index) => {
        const tab = document.createElement('div');
        tab.className = `doc-tab ${index === activeDocIndex ? 'active' : ''}`;
        tab.draggable = true;
        // Fareyi üzerinde bekletince dosya adını ipucu (tooltip) olarak gösterir
        tab.title = doc.name;

        tab.innerHTML = `
            <img src="${doc.thumbnail}" alt="thumb">
            <button class="doc-close" title="Dosyayı Kapat">&times;</button>
        `;

        // Sekmeye tıklandığında dosyaya geçiş yap
        tab.addEventListener('mousedown', (e) => {
            // Çarpıya basıldıysa geçiş yapma
            if (e.target.className.includes('doc-close')) return;
            if (activeDocIndex !== index) {
                if (transformMode) applyTransform();
                saveCurrentDocumentState();
                loadDocumentState(index);
            }
        });

        // Dosyayı Kapatma
        tab.querySelector('.doc-close').addEventListener('click', (e) => {
            e.stopPropagation();
            if (documents.length <= 1) {
                alert("En az bir dosya (çalışma alanı) açık kalmalıdır.");
                return;
            }
            if (transformMode && index === activeDocIndex) applyTransform();

            documents.splice(index, 1);

            // Kapanan sekmeye göre yönlendirme yap
            if (activeDocIndex === index) {
                let nextIndex = Math.max(0, index - 1);
                loadDocumentState(nextIndex);
            } else if (activeDocIndex > index) {
                activeDocIndex--;
                updateDocumentTabsUI();
            } else {
                updateDocumentTabsUI();
            }
        });

        // Dosyaların Sırasını Sürükle-Bırak ile Değiştirme
        tab.addEventListener('dragstart', (e) => {
            draggedDocIndex = index;
            tab.style.opacity = '0.5';
        });
        tab.addEventListener('dragend', () => {
            tab.style.opacity = '1';
            container.querySelectorAll('.doc-tab').forEach(t => t.classList.remove('drag-over'));
        });
        tab.addEventListener('dragover', (e) => { e.preventDefault(); tab.classList.add('drag-over'); });
        tab.addEventListener('dragleave', () => { tab.classList.remove('drag-over'); });
        tab.addEventListener('drop', (e) => {
            e.preventDefault();
            if (draggedDocIndex !== null && draggedDocIndex !== index) {
                saveCurrentDocumentState();
                const moved = documents.splice(draggedDocIndex, 1)[0];
                documents.splice(index, 0, moved);

                // Aktif indeksin yeni yerini takip et
                if (activeDocIndex === draggedDocIndex) activeDocIndex = index;
                else if (draggedDocIndex < activeDocIndex && index >= activeDocIndex) activeDocIndex--;
                else if (draggedDocIndex > activeDocIndex && index <= activeDocIndex) activeDocIndex++;

                updateDocumentTabsUI();
            }
        });

        container.appendChild(tab);
    });
}

// === OTOMATİK SKİN MODELİ ALGILAMA (Steve vs Alex) ===
function detectSkinModel(img, res) {
    // Eski nesil 64x32 formatındaki skinler mimari olarak her zaman Steve'dir.
    if (img.height === 32) return 'default';

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = res;
    tempCanvas.height = res;
    const ctx = tempCanvas.getContext('2d');
    ctx.drawImage(img, 0, 0, res, res);
    const data = ctx.getImageData(0, 0, res, res).data;

    const scale = res / 64;
    let isSlim = true;

    // Alex (3px) modelinde %100 şeffaf (boş) olması gereken kritik noktalar:
    // Sadece sağ ve sol kolun arka yüzeylerindeki son 2 piksellik kısımları tarıyoruz.
    const checkAreas = [
        { x: 54, y: 20, w: 2, h: 12 }, // Sağ Kol Arka Yüz Fazlalığı
        { x: 46, y: 52, w: 2, h: 12 }  // Sol Kol Arka Yüz Fazlalığı
    ];

    for (let area of checkAreas) {
        for (let y = area.y * scale; y < (area.y + area.h) * scale; y++) {
            for (let x = area.x * scale; x < (area.x + area.w) * scale; x++) {
                const alpha = data[(y * res + x) * 4 + 3];
                // Ufak renk kalıntılarını (artifact) Steve sanmaması için saydamlık sınırını 128 yaptık.
                // Eğer burada net ve dolu bir piksel (alpha > 128) varsa, model kesinlikle Steve'dir.
                if (alpha > 128) {
                    isSlim = false;
                    break;
                }
            }
            if (!isSlim) break;
        }
        if (!isSlim) break;
    }

    return isSlim ? 'slim' : 'default';
}
let layers = [];
let activeLayerIndex = 0;
let layerIdCounter = 0;
let draggedLayerIndex = null;
let transformMode = false;
let transformData = {
    canvas: null, x: 0, y: 0, w: 0, h: 0, origX: 0, origY: 0, origW: 0, origH: 0,
    scaleX: 1, scaleY: 1, angle: 0, startX: 0, startY: 0, isDragging: false, dragType: null, originalPixels: null
};
let clipboardData = null;
let originalStateData = null;

const winHueSat = document.getElementById('window-hue-sat');
const winBriCon = document.getElementById('window-bri-con');
const layerImport = document.getElementById('layer-import-hidden');
const swapBtn = document.getElementById('swap-colors');
const mirrorLabel = document.getElementById('mirror-basic-label');

// === KATMANLAR (LAYERS) MOTORU ===
function createLayerObj(name) {
    const canvas = document.createElement('canvas');
    canvas.width = SKIN_RES; canvas.height = SKIN_RES;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    return { id: layerIdCounter++, name: name, canvas: canvas, ctx: ctx, opacity: 255, blendMode: 'source-over', visible: true };
}

function renderComposite() {
    ctx2d.clearRect(0, 0, SKIN_RES, SKIN_RES);
    for (let i = layers.length - 1; i >= 0; i--) {
        const l = layers[i];
        if (!l.visible) continue;
        
        ctx2d.globalAlpha = l.opacity / 255;
        ctx2d.globalCompositeOperation = l.blendMode;
        
        // Taşıma (Transform) sırasında aktif katmana canlı olarak silgi ve resim uyguluyoruz
        if (typeof transformMode !== 'undefined' && transformMode && i === activeLayerIndex && typeof transformData !== 'undefined' && transformData && transformData.maskCanvas) {
            const tempC = document.createElement('canvas');
            tempC.width = SKIN_RES; tempC.height = SKIN_RES;
            const tempCtx = tempC.getContext('2d');
            tempCtx.imageSmoothingEnabled = false;
            tempCtx.drawImage(l.canvas, 0, 0);
            
            const cx = transformData.x + transformData.w/2;
            const cy = transformData.y + transformData.h/2;
            
            tempCtx.save();
            tempCtx.imageSmoothingEnabled = false;
            tempCtx.translate(cx, cy);
            tempCtx.rotate(transformData.angle);
            tempCtx.scale(transformData.scaleX, transformData.scaleY);
            
            // Maske kadar deliği anlık olarak aç
            tempCtx.globalCompositeOperation = 'destination-out';
            tempCtx.drawImage(transformData.maskCanvas, -transformData.w/2, -transformData.h/2, transformData.w, transformData.h);
            
            // Havada taşınan resmi anlık olarak oturt
            tempCtx.globalCompositeOperation = 'source-over';
            tempCtx.drawImage(transformData.canvas, -transformData.w/2, -transformData.h/2, transformData.w, transformData.h);
            tempCtx.restore();

            // YENİ: Kopyalanan/Taşınan Şeklin Canlı Ayna (Mirror) Yansıması
            if (typeof getMirroredPixel === 'function' && typeof mirrorMode !== 'undefined' && mirrorMode > 0) {
                // Performans için geçici canvasları hafızada tutuyoruz (Kasmayı önler)
                if (!window.mirrorTempMask) {
                    window.mirrorTempMask = document.createElement('canvas');
                    window.mirrorTempImg = document.createElement('canvas');
                    window.mirrorTempMaskCtx = window.mirrorTempMask.getContext('2d', {willReadFrequently: true});
                    window.mirrorTempImgCtx = window.mirrorTempImg.getContext('2d', {willReadFrequently: true});
                }
                window.mirrorTempMask.width = SKIN_RES; window.mirrorTempImg.width = SKIN_RES;
                const mCtx = window.mirrorTempMaskCtx; const iCtx = window.mirrorTempImgCtx;
                
                mCtx.clearRect(0,0,SKIN_RES,SKIN_RES); iCtx.clearRect(0,0,SKIN_RES,SKIN_RES);
                
                // Maskeyi sanal olarak hareket ettir
                mCtx.imageSmoothingEnabled = false;
                mCtx.translate(cx, cy); mCtx.rotate(transformData.angle); mCtx.scale(transformData.scaleX, transformData.scaleY);
                mCtx.drawImage(transformData.maskCanvas, -transformData.w/2, -transformData.h/2, transformData.w, transformData.h);
                mCtx.setTransform(1,0,0,1,0,0);
                
                // Resmi sanal olarak hareket ettir
                iCtx.imageSmoothingEnabled = false;
                iCtx.translate(cx, cy); iCtx.rotate(transformData.angle); iCtx.scale(transformData.scaleX, transformData.scaleY);
                iCtx.drawImage(transformData.canvas, -transformData.w/2, -transformData.h/2, transformData.w, transformData.h);
                iCtx.setTransform(1,0,0,1,0,0);
                
                const mData = mCtx.getImageData(0,0,SKIN_RES,SKIN_RES).data;
                const iData = iCtx.getImageData(0,0,SKIN_RES,SKIN_RES).data;
                const tImgData = tempCtx.getImageData(0,0,SKIN_RES,SKIN_RES);
                const tData = tImgData.data;
                
                // Yansımayı pixel-perfect olarak karşıya aktar
                for(let y=0; y<SKIN_RES; y++){
                    for(let x=0; x<SKIN_RES; x++){
                        const idx = (y*SKIN_RES+x)*4;
                        if(mData[idx+3] > 0){
                            const mirrored = getMirroredPixel(x, y);
                            if(mirrored){
                                const mIdx = (mirrored[1]*SKIN_RES+mirrored[0])*4;
                                // Karşı tarafı del (saydamlaştır)
                                tData[mIdx] = 0; tData[mIdx+1] = 0; tData[mIdx+2] = 0; tData[mIdx+3] = 0;
                                // Karşı tarafa resmi çiz
                                if(iData[idx+3] > 0){
                                    tData[mIdx] = iData[idx]; tData[mIdx+1] = iData[idx+1]; tData[mIdx+2] = iData[idx+2]; tData[mIdx+3] = iData[idx+3];
                                }
                            }
                        }
                    }
                }
                tempCtx.putImageData(tImgData, 0, 0);
            }
            
            ctx2d.drawImage(tempC, 0, 0);
        } else {
            ctx2d.drawImage(l.canvas, 0, 0);
        }
    }
    
    ctx2d.globalAlpha = 1.0;
    ctx2d.globalCompositeOperation = 'source-over';
    
    if (typeof updateTexture === 'function') updateTexture(); 
    
    if (layers[activeLayerIndex]) {
        const activeThumb = document.getElementById(`thumb-layer-${layers[activeLayerIndex].id}`);
        if(activeThumb) activeThumb.src = layers[activeLayerIndex].canvas.toDataURL();
    }
    if (activeDocIndex >= 0 && documents[activeDocIndex]) {
        documents[activeDocIndex].thumbnail = canvas2d.toDataURL();
        const container = document.getElementById('document-tabs-container');
        if (container) {
            const activeTabImg = container.children[activeDocIndex]?.querySelector('img');
            if (activeTabImg) activeTabImg.src = documents[activeDocIndex].thumbnail;
        }
    }
}

function updateLayerUI() {
    const list = document.getElementById('layer-list');
    list.innerHTML = '';
    layers.forEach((l, index) => {
        const item = document.createElement('div');
        item.className = `layer-item ${index === activeLayerIndex ? 'active' : ''} ${!l.visible ? 'hidden-layer' : ''}`;
        item.draggable = true;
        item.style.padding = "8px 12px";

        item.innerHTML = `
            <div style="display: flex; align-items: center; flex: 1; overflow: hidden;">
                <img id="thumb-layer-${l.id}" src="${l.canvas.toDataURL()}" style="width: 48px; height: 48px; min-width: 48px; image-rendering: pixelated; border: 1px solid #111; background: repeating-conic-gradient(#555 0% 25%, #888 0% 50%) 50% / 8px 8px; margin-right: 12px; border-radius: 4px;">
                <span class="layer-name" style="font-size: 14px; font-weight: 500;">${l.name}</span>
            </div>
            <button class="layer-vis-btn" title="Görünürlük" style="width: 24px; height: 24px;">
                <svg viewBox="0 0 24 24" style="width: 18px; height: 18px;"><path fill="currentColor" d="${l.visible ? 'M12 4.5C7 4.5 2.7 7.6 1 12c1.7 4.4 6 7.5 11 7.5s9.3-3.1 11-7.5c-1.7-4.4-6-7.5-11-7.5zM12 17c-2.8 0-5-2.2-5-5s2.2-5 5-5 5 2.2 5 5-2.2 5-5 5zm0-8c-1.7 0-3 1.3-3 3s1.3 3 3 3 3-1.3 3-3-1.3-3-3-3z' : 'M12 7c2.8 0 5 2.2 5 5 0 .6-.1 1.2-.3 1.8l-8.5-8.5C9.4 7.1 10.7 7 12 7zm-5.7 1.8L4.1 6.5C2.5 8 1.4 9.9 1 12c1.7 4.4 6 7.5 11 7.5 1.7 0 3.3-.4 4.7-1.1l-2.2-2.2c-.8.5-1.6.8-2.5.8-2.8 0-5-2.2-5-5 0-.9.3-1.7.8-2.5l-1.5-1.5z'}"/></svg>
            </button>
        `;

        item.addEventListener('mousedown', () => {
            if (activeLayerIndex !== index) {
                if (transformMode) applyTransform();
                activeLayerIndex = index;
                updateLayerUI();
            }
        });

        item.querySelector('.layer-vis-btn').addEventListener('mousedown', (e) => {
            e.stopPropagation(); l.visible = !l.visible; updateLayerUI(); renderComposite(); saveHistory();
        });

        item.addEventListener('dblclick', () => {
            activeLayerIndex = index;
            document.getElementById('layer-prop-name').value = l.name;
            document.getElementById('layer-prop-opacity').value = l.opacity;
            document.getElementById('layer-prop-op-val').innerText = l.opacity;
            document.getElementById('layer-prop-blend').value = l.blendMode;
            document.getElementById('layer-prop-visible').checked = l.visible;

            document.querySelectorAll('.adj-window, .ref-window').forEach(w => w.style.zIndex = 1500);
            const win = document.getElementById('window-layer-props');
            win.style.zIndex = 15001;
            win.style.display = 'flex';
        });

        item.addEventListener('dragstart', () => { draggedLayerIndex = index; item.style.opacity = '0.5'; });
        item.addEventListener('dragend', () => { item.style.opacity = '1'; document.querySelectorAll('.layer-item').forEach(i => i.classList.remove('drag-over')); });
        item.addEventListener('dragover', (e) => { e.preventDefault(); item.classList.add('drag-over'); });
        item.addEventListener('dragleave', () => { item.classList.remove('drag-over'); });
        item.addEventListener('drop', (e) => {
            e.preventDefault();
            if (draggedLayerIndex !== null && draggedLayerIndex !== index) {
                const moved = layers.splice(draggedLayerIndex, 1)[0];
                layers.splice(index, 0, moved);
                activeLayerIndex = index;
                updateLayerUI(); renderComposite(); saveHistory();
            }
        });
        list.appendChild(item);
    });
}

document.getElementById('btn-layer-new').addEventListener('click', () => {
    if (transformMode) applyTransform();
    layers.splice(activeLayerIndex, 0, createLayerObj(`Layer ${layers.length + 1}`));
    updateLayerUI(); saveHistory();
});
document.getElementById('btn-layer-del').addEventListener('click', () => {
    if (transformMode) cancelTransform();
    if (layers.length > 1) {
        layers.splice(activeLayerIndex, 1);
        if (activeLayerIndex >= layers.length) activeLayerIndex = layers.length - 1;
        updateLayerUI(); renderComposite(); saveHistory();
    }
});
document.getElementById('btn-layer-dup').addEventListener('click', () => {
    if (transformMode) applyTransform();
    const src = layers[activeLayerIndex];
    const dup = createLayerObj(src.name + " Copy");
    dup.opacity = src.opacity; dup.blendMode = src.blendMode; dup.visible = src.visible;
    dup.ctx.drawImage(src.canvas, 0, 0);
    layers.splice(activeLayerIndex, 0, dup);
    updateLayerUI(); renderComposite(); saveHistory();
});
document.getElementById('btn-layer-merge').addEventListener('click', () => {
    if (transformMode) applyTransform();
    if (activeLayerIndex < layers.length - 1) {
        const topL = layers[activeLayerIndex];
        const botL = layers[activeLayerIndex + 1];
        botL.ctx.globalAlpha = topL.opacity / 255;
        botL.ctx.globalCompositeOperation = topL.blendMode;
        botL.ctx.drawImage(topL.canvas, 0, 0);
        botL.ctx.globalAlpha = 1.0; botL.ctx.globalCompositeOperation = 'source-over';
        layers.splice(activeLayerIndex, 1);
        updateLayerUI(); renderComposite(); saveHistory();
    }
});

document.getElementById('btn-layer-import').addEventListener('click', () => layerImport.click());
layerImport.addEventListener('change', (e) => {
    if (transformMode) applyTransform();
    const file = e.target.files[0]; if (!file) return; const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            getActiveCtx().clearRect(0, 0, SKIN_RES, SKIN_RES);
            getActiveCtx().drawImage(img, 0, 0, SKIN_RES, SKIN_RES);
            renderComposite(); saveHistory();
        }; img.src = event.target.result;
    }; reader.readAsDataURL(file); e.target.value = '';
});

// === LAYER PROPERTIES CANLI GÜNCELLEMELER ===
document.getElementById('layer-prop-name').addEventListener('input', (e) => {
    layers[activeLayerIndex].name = e.target.value; updateLayerUI();
});
document.getElementById('layer-prop-opacity').addEventListener('input', (e) => {
    document.getElementById('layer-prop-op-val').innerText = e.target.value;
    layers[activeLayerIndex].opacity = parseInt(e.target.value); renderComposite();
});
document.getElementById('layer-prop-blend').addEventListener('change', (e) => {
    layers[activeLayerIndex].blendMode = e.target.value; renderComposite();
});
document.getElementById('layer-prop-visible').addEventListener('change', (e) => {
    layers[activeLayerIndex].visible = e.target.checked; updateLayerUI(); renderComposite();
});
document.querySelector('#window-layer-props .adj-close-btn').addEventListener('click', () => {
    document.getElementById('window-layer-props').style.display = 'none'; saveHistory();
});

// === UNDO / REDO ===
function saveHistory() {
    const state = layers.map(l => ({
        name: l.name, opacity: l.opacity, blendMode: l.blendMode, visible: l.visible, data: l.canvas.toDataURL()
    }));
    // YENİ: Aktif seçim maskesini ve durumunu (hasSel) da kaydediyoruz
    const stateStr = JSON.stringify({
        activeIdx: activeLayerIndex,
        layers: state,
        selMask: Array.from(selectionMask),
        hasSel: hasSelection
    });
    if (historyStep >= 0 && historyData[historyStep] === stateStr) return;
    historyStep++; historyData.length = historyStep; historyData.push(stateStr);
    if (historyData.length > 200) { historyData.shift(); historyStep--; }
    schedulePreferencesSave();
}
function undo() { if (historyStep > 0) { historyStep--; restoreHistory(historyData[historyStep]); } }
function redo() { if (historyStep < historyData.length - 1) { historyStep++; restoreHistory(historyData[historyStep]); } }
function restoreHistory(stateStr) {
    if (transformMode) cancelTransform();
    const stateObj = JSON.parse(stateStr);

    // YENİ: Geçmişten seçim maskesini yükle
    if (stateObj.selMask) {
        selectionMask.set(stateObj.selMask);
        hasSelection = stateObj.hasSel;
    } else {
        selectionMask.fill(0);
        hasSelection = false;
    }

    layers = [];
    let loadedCount = 0;
    stateObj.layers.forEach((lState, i) => {
        const layer = createLayerObj(lState.name);
        layer.opacity = lState.opacity; layer.blendMode = lState.blendMode; layer.visible = lState.visible;
        layers.push(layer);
        const img = new Image();
        img.onload = () => {
            layer.ctx.clearRect(0, 0, SKIN_RES, SKIN_RES);
            layer.ctx.drawImage(img, 0, 0);
            loadedCount++;
            if (loadedCount === stateObj.layers.length) {
                activeLayerIndex = stateObj.activeIdx;
                updateLayerUI(); renderComposite();
                // Seçim SVG'lerini ekranda tekrar çiz
                if (typeof updateSelectionVisuals === 'function') updateSelectionVisuals();
            }
        };
        img.src = lState.data;
    });
}

function updateCursorState() {
    if (isRoundBrushMode) {
        // 2D Ekran için yakınlaştırmaya (Zoom) duyarlı İmleç
        const s2d = view2D.scale * (512 / SKIN_RES);
        const r2d = (brushSize / 2) * s2d;
        const size2d = Math.max(16, Math.ceil(r2d * 2 + 6));
        const half2d = size2d / 2;

        // Ortasında + (crosshair) olan beyaz/siyah çember SVG'si
        const svg2d = `<svg width="${size2d}" height="${size2d}" xmlns="http://www.w3.org/2000/svg"><circle cx="${half2d}" cy="${half2d}" r="${r2d}" fill="none" stroke="white" stroke-width="1.5"/><circle cx="${half2d}" cy="${half2d}" r="${r2d}" fill="none" stroke="black" stroke-width="0.5" stroke-dasharray="2,2"/><path d="M ${half2d - 4} ${half2d} L ${half2d + 4} ${half2d} M ${half2d} ${half2d - 4} L ${half2d} ${half2d + 4}" stroke="white" stroke-width="1.5"/><path d="M ${half2d - 4} ${half2d} L ${half2d + 4} ${half2d} M ${half2d} ${half2d - 4} L ${half2d} ${half2d + 4}" stroke="black" stroke-width="0.5"/></svg>`;
        const url2d = `data:image/svg+xml;base64,${btoa(svg2d)}`;
        document.getElementById('editor-2d-view').style.cursor = `url(${url2d}) ${half2d} ${half2d}, crosshair`;

        // 3D Ekran için Sabit boyutlu İmleç
        const s3d = 8;
        const r3d = (brushSize / 2) * s3d;
        const size3d = Math.max(16, Math.ceil(r3d * 2 + 6));
        const half3d = size3d / 2;
        const svg3d = `<svg width="${size3d}" height="${size3d}" xmlns="http://www.w3.org/2000/svg"><circle cx="${half3d}" cy="${half3d}" r="${r3d}" fill="none" stroke="white" stroke-width="1.5"/><circle cx="${half3d}" cy="${half3d}" r="${r3d}" fill="none" stroke="black" stroke-width="0.5" stroke-dasharray="2,2"/><path d="M ${half3d - 4} ${half3d} L ${half3d + 4} ${half3d} M ${half3d} ${half3d - 4} L ${half3d} ${half3d + 4}" stroke="white" stroke-width="1.5"/><path d="M ${half3d - 4} ${half3d} L ${half3d + 4} ${half3d} M ${half3d} ${half3d - 4} L ${half3d} ${half3d + 4}" stroke="black" stroke-width="0.5"/></svg>`;
        currentBrushCursorUrl = `url(data:image/svg+xml;base64,${btoa(svg3d)}) ${half3d} ${half3d}, crosshair`;
    } else {
        document.getElementById('editor-2d-view').style.cursor = 'crosshair';
        currentBrushCursorUrl = '';
    }
}

function getActiveCtx() { return layers[activeLayerIndex].ctx; }

function getOrCreateSvgOverlay() {
    let uiSvg = document.getElementById('editor-2d-ui-svg');
    if (!uiSvg) {
        // Vektörel SVG katmanını dinamik oluştur
        uiSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        uiSvg.id = 'editor-2d-ui-svg';
        uiSvg.setAttribute('viewBox', '0 0 512 512');
        uiSvg.style.position = 'absolute';
        uiSvg.style.top = '0';
        uiSvg.style.left = '0';
        uiSvg.style.width = '100%';
        uiSvg.style.height = '100%';
        uiSvg.style.pointerEvents = 'none'; // Tıklamaları engellememesi için
        uiSvg.style.zIndex = '10';
        uiSvg.style.overflow = 'visible';
        document.getElementById('editor-2d-wrapper').appendChild(uiSvg);

        // Performanslı CSS Animasyonu
        const style = document.createElement('style');
        style.innerHTML = `
            @keyframes marchAnts { from { stroke-dashoffset: 8; } to { stroke-dashoffset: 0; } }
            .marching-ants { animation: marchAnts 0.6s linear infinite; }
        `;
        document.head.appendChild(style);
    }
    return uiSvg;
}

function updateSelectionVisuals() {
    selCtx.clearRect(0, 0, 512, 512);
    const uiSvg = getOrCreateSvgOverlay();

    let selGroup = document.getElementById('svg-selection-group');
    if (!selGroup) {
        selGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        selGroup.id = 'svg-selection-group';
        uiSvg.appendChild(selGroup);
    }

    if (transformMode) {
        selGroup.innerHTML = '';
        return;
    }

    const s = 512 / SKIN_RES;
    const showBlueOverlay = (activeTool === 'rect_select' || activeTool === 'magic_wand');
    let svgHTML = '';

    if (rectSelData?.hasReachedMinimum) {
        let rx = Math.min(rectSelData.startX, rectSelData.currentX);
        let ry = Math.min(rectSelData.startY, rectSelData.currentY);
        let rw = Math.abs(rectSelData.currentX - rectSelData.startX) + 1;
        let rh = Math.abs(rectSelData.currentY - rectSelData.startY) + 1;

        if (rectSelMode === 'subtract') selCtx.fillStyle = 'rgba(255, 50, 50, 0.4)';
        else if (rectSelMode === 'xor') selCtx.fillStyle = 'rgba(255, 0, 255, 0.4)';
        else selCtx.fillStyle = 'rgba(0, 120, 255, 0.4)';

        selCtx.fillRect(rx * s, ry * s, rw * s, rh * s);

        svgHTML += `<rect x="${rx * s}" y="${ry * s}" width="${rw * s}" height="${rh * s}" fill="none" stroke="black" stroke-width="0.5" vector-effect="non-scaling-stroke" />`;
        // stroke-dasharray="6,2" ile beyaz çizgiler 6 birim, alttan görünen siyah kısımlar 2 birim oldu.
        svgHTML += `<rect class="marching-ants" x="${rx * s}" y="${ry * s}" width="${rw * s}" height="${rh * s}" fill="none" stroke="white" stroke-width="0.3" stroke-dasharray="6,2" vector-effect="non-scaling-stroke" />`;
    }

    if (hasSelection) {
        let pathD = "";
        for (let y = 0; y < SKIN_RES; y++) {
            for (let x = 0; x < SKIN_RES; x++) {
                if (selectionMask[y * SKIN_RES + x]) {
                    if (showBlueOverlay) {
                        selCtx.fillStyle = 'rgba(0, 120, 255, 0.4)';
                        selCtx.fillRect(x * s, y * s, s, s);
                    }
                    const px = x * s; const py = y * s;
                    if (y === 0 || !selectionMask[(y - 1) * SKIN_RES + x]) { pathD += `M ${px} ${py} L ${px + s} ${py} `; }
                    if (y === SKIN_RES - 1 || !selectionMask[(y + 1) * SKIN_RES + x]) { pathD += `M ${px} ${py + s} L ${px + s} ${py + s} `; }
                    if (x === 0 || !selectionMask[y * SKIN_RES + (x - 1)]) { pathD += `M ${px} ${py} L ${px} ${py + s} `; }
                    if (x === SKIN_RES - 1 || !selectionMask[y * SKIN_RES + (x + 1)]) { pathD += `M ${px + s} ${py} L ${px + s} ${py + s} `; }
                }
            }
        }
        if (pathD) {
            svgHTML += `<path d="${pathD}" fill="none" stroke="black" stroke-width="0.5" vector-effect="non-scaling-stroke" />`;
            // Aynı oran burada da uygulandı
            svgHTML += `<path class="marching-ants" d="${pathD}" fill="none" stroke="white" stroke-width="0.3" stroke-dasharray="6,2" vector-effect="non-scaling-stroke" />`;
        }
    }

    selGroup.innerHTML = svgHTML;
}

function checkHasSelection() {
    hasSelection = false;
    for (let i = 0; i < selectionMask.length; i++) {
        if (selectionMask[i]) { hasSelection = true; break; }
    }
}

function pickColorFromCanvas(px, py, e = null) {
    try {
        // Görünen rengi al: 3D dış katman açıkken de ekranda görünen piksel seçilir.
        const pixel = ctx2d.getImageData(px, py, 1, 1).data;

        if (pixel[3] > 0) {
            const r = pixel[0], g = pixel[1], b = pixel[2], a = pixel[3] / 255;
            const hsl = rgbToHslObj(r, g, b);

            // Sağ tık (mousedown) veya basılı tutup sürükleme (mousemove) kontrolü
            const isRightClick = e && (e.button === 2 || e.buttons === 2);

            if (isRightClick) {
                // 2. Rengi (Secondary) Güncelle
                secondaryColor = {
                    h: Math.round(hsl.h * 360),
                    s: Math.round(hsl.s * 100),
                    l: Math.round(hsl.l * 100),
                    a: a
                };
                updateUIColors();
            } else {
                // 1. Rengi (Primary) Güncelle
                currentR = r; currentG = g; currentB = b; currentA = a;
                currentH = Math.round(hsl.h * 360); currentS = Math.round(hsl.s * 100); currentL = Math.round(hsl.l * 100);
                updateUIColors(); addToColorHistory();
            }
        }
    } catch (err) { }
}

// === FIRÇA ÇİZİMİ VE MAX ALPHA HESAPLAMASI ===
function drawSingleDab(ctx, cx, cy, r, g, b, a, isEraser) {
    if (!isRoundBrushMode) {
        // NORMAL KALEM: Sadece 1x1 Keskin Kare Çizer (Eski mantıkla sorunsuz devam eder)
        const rx = Math.round(cx);
        const ry = Math.round(cy);
        if (rx < 0 || rx >= SKIN_RES || ry < 0 || ry >= SKIN_RES) return;

        const pixelKey = `${rx},${ry}`;
        if (!strokePixels.has(pixelKey)) {
            strokePixels.add(pixelKey);
            if (isEraser) ctx.clearRect(rx, ry, 1, 1);
            else {
                ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`;
                ctx.fillRect(rx, ry, 1, 1);
            }
        }
        return;
    }

    // YUVARLAK FIRÇA (Max Alpha Blend Algoritması)
    const radius = brushSize / 2;
    const innerRadius = radius * (brushHardness / 100);
    // Fırçanın piksellerin ortasına hizalanması için
    const centerX = cx + 0.5;
    const centerY = cy + 0.5;

    // Fırçanın dokunduğu alanın sınırlarını (Bounding Box) belirle
    const minX = Math.max(0, Math.floor(centerX - radius - 1));
    const maxX = Math.min(SKIN_RES - 1, Math.ceil(centerX + radius + 1));
    const minY = Math.max(0, Math.floor(centerY - radius - 1));
    const maxY = Math.min(SKIN_RES - 1, Math.ceil(centerY + radius + 1));

    // Belirlenen alan içindeki pikselleri tara ve en yüksek fırça etkisini kaydet
    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            if (hasSelection && !selectionMask[y * SKIN_RES + x]) continue;

            const dist = Math.sqrt(Math.pow((x + 0.5) - centerX, 2) + Math.pow((y + 0.5) - centerY, 2));

            if (dist <= radius) {
                let pixelA = 1.0;
                // Yumuşak kenar hesaplaması (Anti-aliasing / Feathering)
                if (dist > innerRadius && radius > innerRadius) {
                    pixelA = 1.0 - ((dist - innerRadius) / (radius - innerRadius));
                }
                pixelA *= a; // Fırçanın ana opacity değeri ile çarp

                const idx = y * SKIN_RES + x;
                // EĞER BU VURUŞTAKİ SAYDAMLIK, ÖNCEKİ VURUŞTAN YÜKSEKSE GÜNCELLE
                // (İşte çizgilerin üst üste binip sertleşmesini engelleyen kod burasıdır)
                if (pixelA > strokeAlphaMap[idx]) {
                    strokeAlphaMap[idx] = pixelA;

                    // Değişen alanı (Dirty Box) genişlet
                    if (x < strokeDirtyBox.minX) strokeDirtyBox.minX = x;
                    if (x > strokeDirtyBox.maxX) strokeDirtyBox.maxX = x;
                    if (y < strokeDirtyBox.minY) strokeDirtyBox.minY = y;
                    if (y > strokeDirtyBox.maxY) strokeDirtyBox.maxY = y;
                }
            }
        }
    }
}

// === ANA BOYAMA MOTORU ===
function applyBrush(px, py, e = null) {
    // YENİ: Renk seçici aracındaysak VEYA Alt tuşuna basılı tutuyorsak renk seç.
    // e.altKey kontrolü sayesinde Alt + Sol Tık 1. Rengi, Alt + Sağ Tık 2. Rengi alacaktır!
    if (activeTool === 'picker' || (e && e.altKey)) {
        pickColorFromCanvas(px, py, e);
        return;
    }

    if (!layers[activeLayerIndex].visible) return;

    const actCtx = getActiveCtx();

    // Sağ tık kontrolü (2. Renk)
    const isRightClick = e && (e.button === 2 || e.buttons === 2);
    let drawR = currentR, drawG = currentG, drawB = currentB, drawA = currentA;
    if (isRightClick) {
        const rgb = typeof hslToRgbArr === 'function' ? hslToRgbArr(secondaryColor.h / 360, secondaryColor.s / 100, secondaryColor.l / 100) : [0, 0, 0];
        drawR = rgb[0]; drawG = rgb[1]; drawB = rgb[2]; drawA = secondaryColor.a;
    }

    const isEraser = activeTool === 'eraser';

    // Boya Kovası
    if (isBucketMode) {
        const targetPixels = [[px, py]];
        const mirrored = typeof getMirroredPixel === 'function' ? getMirroredPixel(px, py) : null;
        if (mirrored) targetPixels.push(mirrored);
        floodFill(targetPixels, e);
        hasDrawnStroke = true;
        return;
    }

    // İlk tıklamada başlangıç noktasını kaydet ve Fırça Motorunu Başlat
    if (lastDrawX === null || lastDrawY === null) {
        lastDrawX = px;
        lastDrawY = py;

        if (isRoundBrushMode) {
            // Katmanın o anki orijinal halini dondur (Snapshot al)
            strokeOriginalData = actCtx.getImageData(0, 0, SKIN_RES, SKIN_RES);
            strokeAlphaMap = new Float32Array(SKIN_RES * SKIN_RES);
            strokeDirtyBox = { minX: SKIN_RES, minY: SKIN_RES, maxX: -1, maxY: -1 };
        }
    }

    const dx = px - lastDrawX;
    const dy = py - lastDrawY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    // Yuvarlak fırça ise çizgi kopmaması için nokta (step) sayısını artırır
    const steps = isRoundBrushMode ? Math.max(1, Math.ceil(dist * 2)) : Math.max(1, Math.ceil(dist));

    // Kalem modu için Maskeleme (Seçim Alanından taşmamak için)
    if (!isRoundBrushMode && hasSelection) {
        actCtx.save();
        actCtx.beginPath();
        for (let y = 0; y < SKIN_RES; y++) {
            for (let x = 0; x < SKIN_RES; x++) {
                if (selectionMask[y * SKIN_RES + x]) {
                    actCtx.rect(x, y, 1, 1);
                    
                    // YENİ: Ayna açıksa, çizim sınırı (clip maskesi) içine aynalanan karşı tarafı da dahil et
                    if (typeof getMirroredPixel === 'function' && typeof mirrorMode !== 'undefined' && mirrorMode > 0) {
                        const mirrored = getMirroredPixel(x, y);
                        if (mirrored) actCtx.rect(mirrored[0], mirrored[1], 1, 1);
                    }
                }
            }
        }
        actCtx.clip();
    }

    // Noktaları Interpolate et
    for (let i = 0; i <= steps; i++) {
        const cx = lastDrawX + (dx * (i / steps));
        const cy = lastDrawY + (dy * (i / steps));

        drawSingleDab(actCtx, cx, cy, drawR, drawG, drawB, drawA, isEraser);

        const mirrored = typeof getMirroredPixel === 'function' ? getMirroredPixel(Math.round(cx), Math.round(cy)) : null;
        if (mirrored) {
            const mx = isRoundBrushMode ? mirrored[0] + (cx - Math.round(cx)) : mirrored[0];
            const my = isRoundBrushMode ? mirrored[1] + (cy - Math.round(cy)) : mirrored[1];
            drawSingleDab(actCtx, mx, my, drawR, drawG, drawB, drawA, isEraser);
        }
    }

    if (!isRoundBrushMode && hasSelection) actCtx.restore();

    // YENİ EKLENDİ: Yuvarlak Fırça İçin Toplu Ekrana Çizim (Max Alpha Blending Composite)
    if (isRoundBrushMode && strokeDirtyBox && strokeDirtyBox.minX <= strokeDirtyBox.maxX) {
        const minX = strokeDirtyBox.minX, minY = strokeDirtyBox.minY;
        const maxX = strokeDirtyBox.maxX, maxY = strokeDirtyBox.maxY;

        // Katmanın çizimden önceki "orijinal" halinin bir kopyasını al
        const newImgData = new ImageData(new Uint8ClampedArray(strokeOriginalData.data), SKIN_RES, SKIN_RES);

        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const idx = y * SKIN_RES + x;
                const srcA = strokeAlphaMap[idx];

                if (srcA > 0) {
                    const pIdx = idx * 4;
                    if (isEraser) {
                        // Silgi: Orijinal alphayı srcA oranı kadar azalt
                        const origA = strokeOriginalData.data[pIdx + 3] / 255;
                        newImgData.data[pIdx + 3] = Math.max(0, Math.round(origA * (1 - srcA) * 255));
                    } else {
                        // Normal Fırça Boyama (Source-Over Blending)
                        const dstR = strokeOriginalData.data[pIdx];
                        const dstG = strokeOriginalData.data[pIdx + 1];
                        const dstB = strokeOriginalData.data[pIdx + 2];
                        const dstA = strokeOriginalData.data[pIdx + 3] / 255;

                        const outA = srcA + dstA * (1 - srcA);
                        if (outA > 0) {
                            newImgData.data[pIdx] = Math.round((drawR * srcA + dstR * dstA * (1 - srcA)) / outA);
                            newImgData.data[pIdx + 1] = Math.round((drawG * srcA + dstG * dstA * (1 - srcA)) / outA);
                            newImgData.data[pIdx + 2] = Math.round((drawB * srcA + dstB * dstA * (1 - srcA)) / outA);
                            newImgData.data[pIdx + 3] = Math.round(outA * 255);
                        }
                    }
                }
            }
        }
        actCtx.putImageData(newImgData, 0, 0);
    }

    lastDrawX = px;
    lastDrawY = py;
    hasDrawnStroke = true;

    renderComposite();
}

function floodFill(startCoords, e = null) {
    if (!layers[activeLayerIndex].visible) return;
    const actCtx = getActiveCtx();
    const tolPercent = document.getElementById('slider-tol').value / 100;
    const targetDistSq = (255*255 * 4) * (tolPercent * tolPercent);
    const imgData = actCtx.getImageData(0,0,SKIN_RES,SKIN_RES); 
    const data = imgData.data;
    const visited = new Uint8Array(SKIN_RES * SKIN_RES);
    
    // YENİ: Ayna açıksa, kova aracının maske sınırlarını karşı tarafı da kapsayacak şekilde sanal olarak genişlet
    let effectiveMask = selectionMask;
    if (hasSelection && typeof getMirroredPixel === 'function' && typeof mirrorMode !== 'undefined' && mirrorMode > 0) {
        effectiveMask = new Uint8Array(selectionMask);
        for (let y = 0; y < SKIN_RES; y++) {
            for (let x = 0; x < SKIN_RES; x++) {
                if (selectionMask[y * SKIN_RES + x]) {
                    const mirrored = getMirroredPixel(x, y);
                    if (mirrored) effectiveMask[mirrored[1] * SKIN_RES + mirrored[0]] = 1;
                }
            }
        }
    }
    
    const isEraser = activeTool === 'eraser';
    const isRightClick = e && (e.button === 2 || e.buttons === 2);
    
    let fillR = currentR, fillG = currentG, fillB = currentB, fillA = currentA;
    if (isRightClick) {
        const rgb = typeof hslToRgbArr === 'function' ? hslToRgbArr(secondaryColor.h / 360, secondaryColor.s / 100, secondaryColor.l / 100) : [0,0,0];
        fillR = rgb[0]; fillG = rgb[1]; fillB = rgb[2]; fillA = secondaryColor.a;
    }

    const fillRgba = isEraser ? [0,0,0,0] : [fillR, fillG, fillB, Math.round(fillA * 255)];
    const a_src = isEraser ? 0 : fillA; 
    const isSlim = currentModel === 'slim';
    const isGlobalFill = e && e.ctrlKey && e.shiftKey;

    startCoords.forEach(([startX, startY]) => {
        // YENİ: selectionMask yerine effectiveMask kullanıldı
        if (hasSelection && !effectiveMask[startY * SKIN_RES + startX]) return;
        const bounds = getBoundingFace(startX, startY, isSlim);
        const minX = bounds[0], minY = bounds[1], maxX = bounds[0]+bounds[2]-1, maxY = bounds[1]+bounds[3]-1;
        const startIdx = (startY * SKIN_RES + startX) * 4;
        const sr = data[startIdx], sg = data[startIdx+1], sb = data[startIdx+2], sa = data[startIdx+3];

        if (tolPercent === 0 && !isEraser && sr === fillRgba[0] && sg === fillRgba[1] && sb === fillRgba[2] && sa === fillRgba[3]) return;
        if (tolPercent === 0 && isEraser && sa === 0) return;
        
        if (isGlobalFill) {
            for (let i = 0; i < SKIN_RES * SKIN_RES; i++) {
                // YENİ: selectionMask yerine effectiveMask kullanıldı
                if (hasSelection && !effectiveMask[i]) continue;
                const idx = i * 4;
                const distSq = Math.pow(data[idx]-sr,2) + Math.pow(data[idx+1]-sg,2) + Math.pow(data[idx+2]-sb,2) + Math.pow(data[idx+3]-sa,2);
                if (distSq <= targetDistSq) {
                    if (isEraser) { data[idx] = 0; data[idx+1] = 0; data[idx+2] = 0; data[idx+3] = 0; } 
                    else {
                        if (a_src === 1) { data[idx] = fillRgba[0]; data[idx+1] = fillRgba[1]; data[idx+2] = fillRgba[2]; data[idx+3] = 255; } 
                        else { 
                            let r_dst = data[idx], g_dst = data[idx+1], b_dst = data[idx+2], a_dst = data[idx+3] / 255;
                            let a_out = a_src + a_dst * (1 - a_src);
                            if (a_out > 0) {
                                data[idx] = Math.round((fillRgba[0] * a_src + r_dst * a_dst * (1 - a_src)) / a_out);
                                data[idx+1] = Math.round((fillRgba[1] * a_src + g_dst * a_dst * (1 - a_src)) / a_out);
                                data[idx+2] = Math.round((fillRgba[2] * a_src + b_dst * a_dst * (1 - a_src)) / a_out);
                                data[idx+3] = Math.round(a_out * 255);
                            }
                        }
                    }
                }
            }
        } else {
            const queue = [];
            queue.push([startX, startY]); visited[startY * SKIN_RES + startX] = 1;

            while(queue.length > 0) {
                const [x, y] = queue.shift();
                const i = y * SKIN_RES + x;
                const idx = i * 4;
                const distSq = Math.pow(data[idx]-sr,2) + Math.pow(data[idx+1]-sg,2) + Math.pow(data[idx+2]-sb,2) + Math.pow(data[idx+3]-sa,2);

                if (distSq <= targetDistSq) {
                    if (isEraser) { data[idx] = 0; data[idx+1] = 0; data[idx+2] = 0; data[idx+3] = 0; } 
                    else {
                        if (a_src === 1) { data[idx] = fillRgba[0]; data[idx+1] = fillRgba[1]; data[idx+2] = fillRgba[2]; data[idx+3] = 255; } 
                        else { 
                            let r_dst = data[idx], g_dst = data[idx+1], b_dst = data[idx+2], a_dst = data[idx+3] / 255;
                            let a_out = a_src + a_dst * (1 - a_src);
                            if (a_out > 0) {
                                data[idx] = Math.round((fillRgba[0] * a_src + r_dst * a_dst * (1 - a_src)) / a_out);
                                data[idx+1] = Math.round((fillRgba[1] * a_src + g_dst * a_dst * (1 - a_src)) / a_out);
                                data[idx+2] = Math.round((fillRgba[2] * a_src + b_dst * a_dst * (1 - a_src)) / a_out);
                                data[idx+3] = Math.round(a_out * 255);
                            }
                        }
                    }
                    // YENİ: selectionMask yerine effectiveMask kullanıldı
                    if (x > minX && !visited[y*SKIN_RES+x-1] && (!hasSelection || effectiveMask[y*SKIN_RES+x-1])) { queue.push([x-1, y]); visited[y*SKIN_RES+x-1] = 1; }
                    if (x < maxX && !visited[y*SKIN_RES+x+1] && (!hasSelection || effectiveMask[y*SKIN_RES+x+1])) { queue.push([x+1, y]); visited[y*SKIN_RES+x+1] = 1; }
                    if (y > minY && !visited[(y-1)*SKIN_RES+x] && (!hasSelection || effectiveMask[(y-1)*SKIN_RES+x])) { queue.push([x, y-1]); visited[(y-1)*SKIN_RES+x] = 1; }
                    if (y < maxY && !visited[(y+1)*SKIN_RES+x] && (!hasSelection || effectiveMask[(y+1)*SKIN_RES+x])) { queue.push([x, y+1]); visited[(y+1)*SKIN_RES+x] = 1; }
                }
            }
        }
    });
    actCtx.putImageData(imgData, 0, 0);
    renderComposite();
}

function updateToolTitles() {
    document.getElementById('tool-brush').title = `Kalem (${toolShortcuts.brush.toUpperCase()})`;
    document.getElementById('tool-bucket').title = `Boya Kovası (${toolShortcuts.bucket.toUpperCase()})`;
    document.getElementById('tool-eraser').title = `Silgi (${toolShortcuts.eraser.toUpperCase()})`;
    document.getElementById('tool-picker').title = `Renk Seçici (${toolShortcuts.picker.toUpperCase()})`;
    if (document.getElementById('tool-rect_select')) document.getElementById('tool-rect_select').title = `Seçim Aracı (${toolShortcuts.rect_select.toUpperCase()})`;
    if (document.getElementById('tool-magic_wand')) document.getElementById('tool-magic_wand').title = `Sihirli Değnek (${toolShortcuts.magic_wand.toUpperCase()})`;
    if (document.getElementById('tool-transform')) document.getElementById('tool-transform').title = `Seçimi Taşı (${toolShortcuts.transform.toUpperCase()})`;
    document.getElementById('swap-colors').title = `Renkleri Değiştir (${toolShortcuts.swap.toUpperCase()})`;
    document.getElementById('mirror-basic-label').title = `Ayna Kısayolu (${toolShortcuts.mirror.toUpperCase()})`;
}

// === ARAÇ (TOOL) ARAYÜZÜ VE DEĞİŞİM MANTIĞI ===
function setTool(tool) {
    if (transformMode && tool !== 'transform') applyTransform();

    if (tool === 'bucket') {
        isBucketMode = !isBucketMode;
        if (isBucketMode) isRoundBrushMode = false; // Fırça ve Kova aynı anda açık kalamaz
        // Seçim vb. araçtaysak, kovaya basınca direkt Kalem'e (Çizime) geç
        if (isBucketMode && !['brush', 'eraser'].includes(activeTool)) activeTool = 'brush';
    } else if (tool === 'round_brush') {
        isRoundBrushMode = !isRoundBrushMode;
        if (isRoundBrushMode) isBucketMode = false;
        if (isRoundBrushMode && !['brush', 'eraser'].includes(activeTool)) activeTool = 'brush';
    } else {
        // Kalem, Silgi, Seçim vs.
        activeTool = tool;
        if (['picker', 'rect_select', 'magic_wand', 'transform'].includes(tool)) {
            isBucketMode = false; isRoundBrushMode = false;
        }
    }

    updateToolUI();
    if (tool === 'transform' && hasSelection && !transformMode) startTransform();
    if (typeof updateSelectionVisuals === 'function') updateSelectionVisuals();
    updateCursorState();
}

function updateToolUI() {
    ['brush', 'eraser', 'picker', 'rect_select', 'magic_wand', 'transform'].forEach(t => {
        const btn = document.getElementById('tool-' + t);
        if (btn) btn.classList.remove('active');
    });

    const activeBtn = document.getElementById('tool-' + activeTool);
    if (activeBtn) activeBtn.classList.add('active');

    const btnBucket = document.getElementById('tool-bucket');
    if (btnBucket) { if (isBucketMode) btnBucket.classList.add('active'); else btnBucket.classList.remove('active'); }

    const btnBrush = document.getElementById('tool-round_brush');
    if (btnBrush) { if (isRoundBrushMode) btnBrush.classList.add('active'); else btnBrush.classList.remove('active'); }

    const tolGroup = document.getElementById('group-tol');
    if (tolGroup) tolGroup.style.display = isBucketMode ? 'flex' : 'none';

    const brushSettings = document.getElementById('group-brush-settings');
    if (brushSettings) brushSettings.style.display = isRoundBrushMode ? 'flex' : 'none';

    updateToolTitles();
}

// BÜTÜN BUTONLARIN TIKLAMA OLAYLARI BURADA YENİDEN TANIMLANIYOR
['brush', 'bucket', 'round_brush', 'eraser', 'picker', 'rect_select', 'magic_wand', 'transform'].forEach(tool => {
    const btn = document.getElementById('tool-' + tool);
    if (btn) {
        btn.onclick = () => setTool(tool);
        btn.addEventListener('contextmenu', (e) => {
            e.preventDefault(); document.querySelectorAll('.tool-btn, .swap-btn, .mirror-settings label, .display-settings label').forEach(b => b.classList.remove('waiting'));
            btn.classList.add('waiting'); customizingShortcutFor = tool;
        });
    }
});

// Fırça Slider Ayarları
document.getElementById('slider-brush-size').addEventListener('input', (e) => {
    brushSize = parseInt(e.target.value);
    document.getElementById('val-brush-size').innerText = brushSize;
    updateCursorState();
});
document.getElementById('slider-brush-hard').addEventListener('input', (e) => {
    brushHardness = parseInt(e.target.value);
    document.getElementById('val-brush-hard').innerText = brushHardness;
});

// YENİ: Dışarıdan HEX kodu girildiğinde rengi güncelleme işlevi
document.getElementById('hex-color-code').addEventListener('change', (e) => {
    let hex = e.target.value.replace('#', '').trim();
    if (hex.length === 3) hex = hex.split('').map(c => c+c).join('');
    
    if (hex.length === 6) {
        const r = parseInt(hex.substring(0,2), 16);
        const g = parseInt(hex.substring(2,4), 16);
        const b = parseInt(hex.substring(4,6), 16);
        
        if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
            currentR = r; currentG = g; currentB = b;
            const hsl = rgbToHslObj(r, g, b);
            currentH = Math.round(hsl.h * 360);
            currentS = Math.round(hsl.s * 100);
            currentL = Math.round(hsl.l * 100);
            if (typeof updateUIColors === 'function') updateUIColors();
            if (typeof addToColorHistory === 'function') addToColorHistory();
        }
    }
});

// YENİ: Boya Kovası tolerans değerini canlı yazdırma
if(document.getElementById('slider-tol')) {
    document.getElementById('slider-tol').addEventListener('input', (e) => {
        document.getElementById('val-slider-tol').innerText = e.target.value + '%';
    });
}
// Renk Değiştirme (Swap) ve Kısayol Ayarları
swapBtn.addEventListener('contextmenu', (e) => { e.preventDefault(); swapBtn.classList.add('waiting'); customizingShortcutFor = 'swap'; });
swapBtn.addEventListener('click', () => {
    // 1. Rengi (Primary) geçici hafızaya al
    const tempH = currentH;
    const tempS = currentS;
    const tempL = currentL;
    const tempA = currentA;

    // 2. Rengi (Secondary), 1. Renge (Primary) aktar
    currentH = secondaryColor.h;
    currentS = secondaryColor.s;
    currentL = secondaryColor.l;
    currentA = secondaryColor.a;

    // Yeni 1. Renk için kesin RGB değerlerini hesapla
    const rgb = typeof hslToRgbArr === 'function' ? hslToRgbArr(currentH / 360, currentS / 100, currentL / 100) : [0, 0, 0];
    currentR = rgb[0];
    currentG = rgb[1];
    currentB = rgb[2];

    // Geçici hafızadaki eski 1. Rengi, 2. Renk (Secondary) yap
    secondaryColor = { h: tempH, s: tempS, l: tempL, a: tempA };

    // Renk kutularını ve slider'ları güncelle
    if (typeof updateUIColors === 'function') updateUIColors();
});

document.getElementById('btn-default-colors').addEventListener('click', () => {
    // 1. Rengi (Primary) Siyah yap
    currentH = 0; currentS = 0; currentL = 0; currentA = 1.0;
    currentR = 0; currentG = 0; currentB = 0;
    
    // 2. Rengi (Secondary) Beyaz yap
    secondaryColor = { h: 0, s: 0, l: 100, a: 1.0 };
    
    if (typeof updateUIColors === 'function') updateUIColors();
});

mirrorLabel.addEventListener('contextmenu', (e) => {
    e.preventDefault(); document.querySelectorAll('.tool-btn, .swap-btn, .mirror-settings label, .display-settings label').forEach(b => b.classList.remove('waiting'));
    mirrorLabel.classList.add('waiting'); customizingShortcutFor = 'mirror';
});

document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'range') return;

    if (isListeningForKey && currentKeyTarget) {
        e.preventDefault(); e.stopPropagation();
        if (e.key !== 'Escape') { toolShortcuts[currentKeyTarget] = e.key.toLowerCase(); updateToolTitles(); schedulePreferencesSave(); }
        const container = document.getElementById('shortcuts-container');
        if (container) {
            container.querySelectorAll('.shortcut-key-btn').forEach(b => {
                b.classList.remove('listening');
                b.innerText = toolShortcuts[b.getAttribute('data-key')].toUpperCase();
            });
        }
        isListeningForKey = false; currentKeyTarget = null; return;
    }

    if (e.key === 'Escape' && isCopyModeActive) { disableCopyMode(); return; }

    if ((e.ctrlKey && e.key.toLowerCase() === 'd') || (e.key === 'Escape' && hasSelection)) {
        e.preventDefault();
        if (transformMode) applyTransform();
        selectionMask.fill(0); checkHasSelection(); updateSelectionVisuals(); saveHistory(); return;
    }

    if (e.ctrlKey && e.key.toLowerCase() === 'c') { e.preventDefault(); copySelectionToClipboard(); return; }
    if (e.ctrlKey && e.key.toLowerCase() === 'x') { e.preventDefault(); cutSelectionToClipboard(); return; }

    if (e.key === 'Delete') {
        if (transformMode) {
            transformMode = false;
            document.getElementById('transform-toolbar').style.display = 'none';
            document.getElementById('editor-2d-transform').getContext('2d').clearRect(0, 0, 512, 512);
            if (typeof renderTransformVisuals === 'function') renderTransformVisuals();
            renderComposite(); saveHistory(); setTool('brush');
        } else if (hasSelection) {
            const actCtx = getActiveCtx();
            const imgData = actCtx.getImageData(0, 0, SKIN_RES, SKIN_RES);
            for (let y = 0; y < SKIN_RES; y++) {
                for (let x = 0; x < SKIN_RES; x++) {
                    if (selectionMask[y * SKIN_RES + x]) {
                        const idx = (y * SKIN_RES + x) * 4;
                        imgData.data[idx + 3] = 0; imgData.data[idx + 2] = 0; imgData.data[idx + 1] = 0; imgData.data[idx] = 0;

                        // YENİ: Ayna açıksa, seçili alanın karşı tarafındaki pikselleri de bul ve sil
                        if (typeof getMirroredPixel === 'function' && typeof mirrorMode !== 'undefined' && mirrorMode > 0) {
                            const mirrored = getMirroredPixel(x, y);
                            if (mirrored) {
                                const mIdx = (mirrored[1] * SKIN_RES + mirrored[0]) * 4;
                                imgData.data[mIdx + 3] = 0; imgData.data[mIdx + 2] = 0; imgData.data[mIdx + 1] = 0; imgData.data[mIdx] = 0;
                            }
                        }
                    }
                }
            }
            actCtx.putImageData(imgData, 0, 0);
            renderComposite(); if (typeof saveHistory === 'function') saveHistory();
        }
        return;
    }

    if (transformMode && e.key === 'Enter') { applyTransform(); return; }
    if (transformMode && e.key === 'Escape') { cancelTransform(); return; }

    if (customizingShortcutFor) {
        e.preventDefault();
        if (e.key !== 'Escape') { toolShortcuts[customizingShortcutFor] = e.key.toLowerCase(); updateToolTitles(); schedulePreferencesSave(); }
        document.querySelectorAll('.tool-btn, .swap-btn, .mirror-settings label, .display-settings label').forEach(b => b.classList.remove('waiting'));
        customizingShortcutFor = null; return;
    }

    if (e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (e.ctrlKey && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }

    if (e.key.toLowerCase() === toolShortcuts.swap) swapBtn.click();
    if (e.key.toLowerCase() === toolShortcuts.mirror) { mirrorBasic.checked = !mirrorBasic.checked; updateMirrorState(); }
    if (e.key.toLowerCase() === toolShortcuts.grid) {
        if (typeof setGridVisible === 'function') setGridVisible(!gridToggle.checked);
        else { gridToggle.checked = !gridToggle.checked; updateTexture(); }
        if (typeof updateMenuStates === 'function') updateMenuStates();
    }

    if (e.key.toLowerCase() === toolShortcuts.brush) setTool('brush');
    if (e.key.toLowerCase() === toolShortcuts.bucket) setTool('bucket');
    if (e.key.toLowerCase() === toolShortcuts.eraser) setTool('eraser');
    if (e.key.toLowerCase() === toolShortcuts.picker) setTool('picker');
    if (is2DMode && e.key.toLowerCase() === toolShortcuts.rect_select) setTool('rect_select');
    if (is2DMode && e.key.toLowerCase() === toolShortcuts.magic_wand) setTool('magic_wand');
    if (is2DMode && e.key.toLowerCase() === toolShortcuts.transform) setTool('transform');
});

function update2DTransform() {
    wrapper2D.style.transform = `translate(${view2D.x}px, ${view2D.y}px) scale(${view2D.scale})`;
    document.getElementById('editor-2d-view').style.backgroundSize = `${16 / view2D.scale}px ${16 / view2D.scale}px`;
    if (typeof drawGrid === 'function') drawGrid();

    // YENİ: Yakınlaştırmalarda SVG çizgilerini ve yuvarlakları ekran boyutunda sabit tutmak için yeniden renderla
    if (typeof updateSelectionVisuals === 'function') updateSelectionVisuals();
    if (typeof renderTransformVisuals === 'function' && transformMode) renderTransformVisuals();
    if (typeof updateCursorState === 'function') updateCursorState();
}

btn3D.addEventListener('click', () => {
    is2DMode = false; btn3D.classList.add('active'); btn2D.classList.remove('active');
    canvas3d.style.display = 'block'; container2D.style.display = 'none';
    if (typeof updateTexture === 'function') updateTexture();
    document.getElementById('btn-3d-screenshot').style.display = 'flex';
    document.getElementById('btn-action-mirror').style.display = 'flex';
    document.getElementById('btn-action-filler').style.display = 'flex';
    document.getElementById('btn-action-guide').style.display = 'none';
    document.querySelectorAll('.tool-2d-only').forEach(el => el.style.display = 'none');
    if (activeTool === 'rect_select' || activeTool === 'magic_wand' || activeTool === 'transform') setTool('brush');
});

btn2D.addEventListener('click', () => {
    is2DMode = true; btn2D.classList.add('active'); btn3D.classList.remove('active');
    canvas3d.style.display = 'none'; container2D.style.display = 'block'; update2DTransform();
    if (typeof updateTexture === 'function') updateTexture();
    document.getElementById('btn-3d-screenshot').style.display = 'none';
    document.getElementById('btn-action-mirror').style.display = 'none';
    document.getElementById('btn-action-filler').style.display = 'none';
    document.getElementById('btn-action-guide').style.display = 'flex';
    document.querySelectorAll('.tool-2d-only').forEach(el => el.style.display = 'flex');
});

container2D.addEventListener('wheel', (e) => {
    if (!is2DMode) return; e.preventDefault();
    const rect = wrapper2D.getBoundingClientRect(); const mx = e.clientX - rect.left; const my = e.clientY - rect.top;
    const ox = mx / view2D.scale; const oy = my / view2D.scale;
    const delta = e.deltaY > 0 ? 0.9 : 1.1; let newScale = view2D.scale * delta; newScale = Math.max(0.2, Math.min(newScale, 20));
    const nx = ox * newScale; const ny = oy * newScale;
    view2D.x -= (nx - mx); view2D.y -= (ny - my); view2D.scale = newScale; update2DTransform();
});

container2D.addEventListener('mousedown', (e) => {
    if (activeTool === 'rect_select' && e.button === 2) return;
    if (activeTool === 'picker' && e.button === 2) return; // YENİ: Renk seçicide sağ tıkla kaydırmayı engelle
    if (activeTool === 'brush' && e.button === 2) return; // YENİ: Kalem aracında sağ tıklamayı kaydırmadan çıkar
    if (activeTool === 'bucket' && e.button === 2) return; // YENİ: Boya kovasında sağ tıklamayı kaydırmadan çıkar
    if (e.button === 1 || e.button === 2) { isPanning2D = true; container2D.style.cursor = 'grabbing'; e.preventDefault(); }
});
window.addEventListener('mousemove', (e) => { if (isPanning2D && is2DMode) { view2D.x += e.movementX; view2D.y += e.movementY; update2DTransform(); } });
window.addEventListener('mouseup', () => { isPanning2D = false; container2D.style.cursor = 'grab'; });
container2D.addEventListener('contextmenu', e => e.preventDefault());

function get2DCoords(e) {
    const rect = renderCanvas.getBoundingClientRect();
    const px = Math.max(0, Math.min(SKIN_RES - 1, Math.floor((e.clientX - rect.left) / rect.width * SKIN_RES)));
    const py = Math.max(0, Math.min(SKIN_RES - 1, Math.floor((e.clientY - rect.top) / rect.height * SKIN_RES)));
    return { px, py };
}

renderCanvas.addEventListener('mousedown', (e) => {
    const { px, py } = get2DCoords(e);

    // Transform aracı yönetimi
    if (activeTool === 'transform' && transformMode) {
        const cx = transformData.x + transformData.w / 2;
        const cy = transformData.y + transformData.h / 2;
        let dx = px - cx;
        let dy = py - cy;
        let a = -transformData.angle;
        let rx = dx * Math.cos(a) - dy * Math.sin(a);
        let ry = dx * Math.sin(a) + dy * Math.cos(a);

        const hw = Math.abs(transformData.w) / 2;
        const hh = Math.abs(transformData.h) / 2;
        const tol = Math.max(0.4, Math.min(1.5, Math.min(hw, hh) * 0.8));

        let hit = null;
        if (Math.abs(rx - (-hw)) < tol && Math.abs(ry - (-hh)) < tol) hit = 'tl';
        else if (Math.abs(rx - hw) < tol && Math.abs(ry - (-hh)) < tol) hit = 'tr';
        else if (Math.abs(rx - (-hw)) < tol && Math.abs(ry - hh) < tol) hit = 'bl';
        else if (Math.abs(rx - hw) < tol && Math.abs(ry - hh) < tol) hit = 'br';
        else if (Math.abs(rx - 0) < tol && Math.abs(ry - (-hh)) < tol) hit = 't';
        else if (Math.abs(rx - 0) < tol && Math.abs(ry - hh) < tol) hit = 'b';
        else if (Math.abs(rx - (-hw)) < tol && Math.abs(ry - 0) < tol) hit = 'l';
        else if (Math.abs(rx - hw) < tol && Math.abs(ry - 0) < tol) hit = 'r';
        else hit = 'move'; // YENİ: Yuvarlaklara denk gelmediği sürece her yere tıklamak şekli TAŞIR!

        if (hit) {
            transformData.isDragging = true; transformData.dragType = hit;
            transformData.startX = px; transformData.startY = py;
            transformData.origX = transformData.x; transformData.origY = transformData.y;
            transformData.origW = transformData.w; transformData.origH = transformData.h;
            transformData.origScaleX = transformData.scaleX;
            transformData.origScaleY = transformData.scaleY;
        }
        return;
    }

    // Seçim aracı yönetimi
    if (activeTool === 'rect_select') {
        if (e.button !== 0 && e.button !== 2) return;
        isDrawing2D = true;

        if (e.button === 2 && e.ctrlKey) rectSelMode = 'xor';
        else if (e.button === 2) rectSelMode = 'subtract';
        else rectSelMode = 'add';

        if (!e.ctrlKey && rectSelMode === 'add') {
            selectionMask.fill(0); hasSelection = false;
        }
        rectSelData = { startX: px, startY: py, currentX: px, currentY: py, hasReachedMinimum: false };
        if (typeof updateSelectionVisuals === 'function') updateSelectionVisuals();
        return;
    }

    // ÇÖZÜM BURADA: Artık renk seçici, kalem ve kova araçları kullanılıyorsa sağ tıklamaya kesin olarak izin veriyoruz!
    if (e.button !== 0 && !['picker', 'brush', 'bucket'].includes(activeTool)) return;

    // Sihirli değnek yönetimi
    if (activeTool === 'magic_wand') {
        if (e.button !== 0) return; // Sihirli değnek sağ tık desteklemez
        if (!e.ctrlKey) { selectionMask.fill(0); }

        if (!window.cachedImageData) window.cachedImageData = ctx2d.getImageData(0, 0, SKIN_RES, SKIN_RES).data;
        const targetColor = ctx2d.getImageData(px, py, 1, 1).data;
        const data = window.cachedImageData;
        const tolPercent = document.getElementById('slider-tol').value / 100;
        const targetDistSq = (255 * 255 * 4) * (tolPercent * tolPercent);

        if (e.ctrlKey && e.shiftKey) {
            for (let i = 0; i < SKIN_RES * SKIN_RES; i++) {
                const idx = i * 4;
                const distSq = Math.pow(data[idx] - targetColor[0], 2) + Math.pow(data[idx + 1] - targetColor[1], 2) + Math.pow(data[idx + 2] - targetColor[2], 2) + Math.pow(data[idx + 3] - targetColor[3], 2);
                if (distSq <= targetDistSq) selectionMask[i] = 1;
            }
        } else {
            const queue = [[px, py]];
            const visited = new Uint8Array(SKIN_RES * SKIN_RES);
            visited[py * SKIN_RES + px] = 1;

            while (queue.length > 0) {
                const [x, y] = queue.shift();
                const i = y * SKIN_RES + x;
                const idx = i * 4;
                const distSq = Math.pow(data[idx] - targetColor[0], 2) + Math.pow(data[idx + 1] - targetColor[1], 2) + Math.pow(data[idx + 2] - targetColor[2], 2) + Math.pow(data[idx + 3] - targetColor[3], 2);

                if (distSq <= targetDistSq) {
                    selectionMask[i] = 1;
                    if (x > 0 && !visited[y * SKIN_RES + x - 1]) { queue.push([x - 1, y]); visited[y * SKIN_RES + x - 1] = 1; }
                    if (x < SKIN_RES - 1 && !visited[y * SKIN_RES + x + 1]) { queue.push([x + 1, y]); visited[y * SKIN_RES + x + 1] = 1; }
                    if (y > 0 && !visited[(y - 1) * SKIN_RES + x]) { queue.push([x, y - 1]); visited[(y - 1) * SKIN_RES + x] = 1; }
                    if (y < SKIN_RES - 1 && !visited[(y + 1) * SKIN_RES + x]) { queue.push([x, y + 1]); visited[(y + 1) * SKIN_RES + x] = 1; }
                }
            }
        }
        checkHasSelection();
        if (typeof updateSelectionVisuals === 'function') updateSelectionVisuals();
        saveHistory();
        return;
    }

    // Çizim işlemi (Fırça ve Boya Kovası vb.) tetiklenir
    isDrawing2D = true;
    strokePixels.clear();
    applyBrush(px, py, e);
});

window.addEventListener('mousemove', (e) => {
    const { px, py } = get2DCoords(e);

    if (activeTool === 'transform' && transformMode && transformData.isDragging) {
        const dx = px - transformData.startX;
        const dy = py - transformData.startY;

        if (transformData.dragType === 'move') {
            transformData.x = transformData.origX + dx;
            transformData.y = transformData.origY + dy;
        } else {
            const type = transformData.dragType;
            let left = transformData.origX;
            let right = transformData.origX + transformData.origW;
            let top = transformData.origY;
            let bottom = transformData.origY + transformData.origH;

            const changesHorizontal = ['tl', 'tr', 'bl', 'br', 'l', 'r'].includes(type);
            const changesVertical = ['tl', 'tr', 'bl', 'br', 't', 'b'].includes(type);

            if (['tl', 'bl', 'l'].includes(type)) left += dx;
            if (['tr', 'br', 'r'].includes(type)) right += dx;
            if (['tl', 'tr', 't'].includes(type)) top += dy;
            if (['bl', 'br', 'b'].includes(type)) bottom += dy;

            if (changesHorizontal) {
                const signedWidth = right - left;
                transformData.x = Math.min(left, right);
                transformData.w = Math.max(1, Math.abs(signedWidth));
                // Tutamaç karşı kenarı geçtiğinde işaret değişir: yatay ayna.
                transformData.scaleX = transformData.origScaleX * (signedWidth < 0 ? -1 : 1);
            }
            if (changesVertical) {
                const signedHeight = bottom - top;
                transformData.y = Math.min(top, bottom);
                transformData.h = Math.max(1, Math.abs(signedHeight));
                // Tutamaç karşı kenarı geçtiğinde işaret değişir: dikey ayna.
                transformData.scaleY = transformData.origScaleY * (signedHeight < 0 ? -1 : 1);
            }
        }
        renderTransformVisuals();
        renderComposite();
        return;
    }

    if (!isDrawing2D) return;

    if (activeTool === 'rect_select' && rectSelData) {
        rectSelData.currentX = px; rectSelData.currentY = py;
        const selectionWidth = Math.abs(rectSelData.currentX - rectSelData.startX) + 1;
        const selectionHeight = Math.abs(rectSelData.currentY - rectSelData.startY) + 1;
        // Eşik bir kez geçildiğinde seçim etkin kalır; fareyi başlangıç
        // noktasına geri yaklaştırmak 1×1 seçime tekrar izin verir.
        if (selectionWidth >= 2 || selectionHeight >= 2) rectSelData.hasReachedMinimum = true;
        updateSelectionVisuals();
        return;
    }

    if (activeTool !== 'magic_wand' && activeTool !== 'rect_select' && activeTool !== 'transform') {
        applyBrush(px, py, e);
    }
});

// SADECE 2D MOTORU İÇİN YÖNETİM
window.addEventListener('mouseup', () => {
    if (!is2DMode) return;

    if (activeTool === 'transform' && transformMode && transformData.isDragging) {
        transformData.isDragging = false;
        if (typeof renderTransformVisuals === 'function') renderTransformVisuals();
        return;
    }

    if (activeTool === 'rect_select' && rectSelData) {
        let rx = Math.min(rectSelData.startX, rectSelData.currentX);
        let ry = Math.min(rectSelData.startY, rectSelData.currentY);
        let rw = Math.abs(rectSelData.currentX - rectSelData.startX) + 1;
        let rh = Math.abs(rectSelData.currentY - rectSelData.startY) + 1;
        // Tek tıklama seçim üretmez. Ancak fare bir kez 2×1 / 1×2 eşiğine
        // ulaştıysa, tekrar 1×1 boyuta küçültülse bile seçim geçerlidir.
        const isLargeEnough = rectSelData.hasReachedMinimum;
        if (isLargeEnough) {
            for (let y = ry; y < ry + rh; y++) {
                for (let x = rx; x < rx + rw; x++) {
                    if (x >= 0 && x < SKIN_RES && y >= 0 && y < SKIN_RES) {
                        if (rectSelMode === 'add') selectionMask[y * SKIN_RES + x] = 1;
                        else if (rectSelMode === 'subtract') selectionMask[y * SKIN_RES + x] = 0;
                        else if (rectSelMode === 'xor') selectionMask[y * SKIN_RES + x] ^= 1;
                    }
                }
            }
        }
        rectSelData = null; checkHasSelection();
        if (typeof updateSelectionVisuals === 'function') updateSelectionVisuals();
        if (isLargeEnough) saveHistory();
    }

    if (isDrawing2D && hasDrawnStroke && activeTool !== 'rect_select' && activeTool !== 'magic_wand' && activeTool !== 'transform') {
        if (typeof saveHistory === 'function') saveHistory();
        if (typeof addToColorHistory === 'function') addToColorHistory();
    }

    if (activeTool === 'transform' && transformMode) transformData.isDragging = false;

    // YENİ EKLENDİ: Fareyi bırakınca çizgi takibini sıfırla ki bir sonraki tıklamada kaldığı yerden çizgi çekmesin
    lastDrawX = null;
    lastDrawY = null;
    strokeOriginalData = null;
    strokeAlphaMap = null;
    strokeDirtyBox = null;

    isDrawing2D = false;
    hasDrawnStroke = false;
    rectSelData = null;
}, true);


function animateSelection(time) {
    // JS döngüsü pasif! Artık her şeyi çok daha performanslı olan CSS animasyonu devraldı.
}

async function initializeEditor() {
    updateToolTitles();
    currentModel = 'default';

    const restoredSkin = await restorePersistentPreferences();
    // Kaydedilmiş bir skin yoksa başlangıç şablonunu oluştur.
    if (!restoredSkin && typeof documents !== 'undefined' && documents.length === 0) {
        loadTemplateAndCreateDoc("Skin 1", 64, currentModel);
    }

    if (viewer3d && typeof enforceUIVisibilityState === 'function') enforceUIVisibilityState();
    requestAnimationFrame(animateSelection);
    preferencesReady = true;
    schedulePreferencesSave();
}

window.addEventListener('load', async () => {
    await initializeEditor();
    setTimeout(() => {
        updateUIColors();
        if (window.cachedImageData === null && typeof updateTexture === 'function') updateTexture();
    }, 150);
});

// ==========================================================================
// === TRANSFORM MOTORU (Seçimi Taşıma, Döndürme, Ölçeklendirme) ===
// ==========================================================================

function getSelectionBounds() {
    let minX = SKIN_RES, minY = SKIN_RES, maxX = -1, maxY = -1;
    for (let y = 0; y < SKIN_RES; y++) {
        for (let x = 0; x < SKIN_RES; x++) {
            if (selectionMask[y * SKIN_RES + x]) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }
    if (minX > maxX) return null;
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function extractSelection() {
    const bounds = getSelectionBounds();
    if (!bounds) return null;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = bounds.w; tempCanvas.height = bounds.h;
    const tempCtx = tempCanvas.getContext('2d');

    const actCtx = getActiveCtx();
    const imgData = actCtx.getImageData(bounds.x, bounds.y, bounds.w, bounds.h);
    const data = imgData.data;
    const originalData = actCtx.getImageData(0, 0, SKIN_RES, SKIN_RES);

    for (let y = 0; y < bounds.h; y++) {
        for (let x = 0; x < bounds.w; x++) {
            const globalX = bounds.x + x;
            const globalY = bounds.y + y;
            if (!selectionMask[globalY * SKIN_RES + globalX]) {
                data[(y * bounds.w + x) * 4 + 3] = 0;
            } else {
                const idx = (globalY * SKIN_RES + globalX) * 4;
                originalData.data[idx + 3] = 0; originalData.data[idx + 2] = 0;
                originalData.data[idx + 1] = 0; originalData.data[idx] = 0;
            }
        }
    }
    tempCtx.putImageData(imgData, 0, 0);
    return { extracted: tempCanvas, updatedLayer: originalData, bounds: bounds };
}

function renderTransformVisuals() {
    const transformCanvas = document.getElementById('editor-2d-transform');
    const transformCtx = transformCanvas.getContext('2d');
    transformCtx.clearRect(0, 0, 512, 512);

    const uiSvg = getOrCreateSvgOverlay();
    let transformGroup = document.getElementById('svg-transform-group');
    if (!transformGroup) {
        transformGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        transformGroup.id = 'svg-transform-group';
        uiSvg.appendChild(transformGroup);
    }

    if (!transformMode) {
        transformGroup.innerHTML = '';
        return;
    }

    const s = 512 / SKIN_RES;
    const cx = transformData.x + transformData.w / 2;
    const cy = transformData.y + transformData.h / 2;

    if (transformData.isDragging) {
        transformGroup.innerHTML = '';
        return;
    }

    const centerSvgX = cx * s;
    const centerSvgY = cy * s;
    const drawW = transformData.w * s;
    const drawH = transformData.h * s;
    const bw = Math.abs(drawW); const bh = Math.abs(drawH);
    const invScale = 1 / view2D.scale;

    let svgHTML = `<g transform="translate(${centerSvgX}, ${centerSvgY}) rotate(${transformData.angle * 180 / Math.PI})">`;

    if (transformData.baseSvgPath) {
        const pathScaleX = (transformData.w / transformData.baseW) * s * transformData.scaleX;
        const pathScaleY = (transformData.h / transformData.baseH) * s * transformData.scaleY;

        svgHTML += `<g transform="scale(${pathScaleX}, ${pathScaleY})">`;
        svgHTML += `<path d="${transformData.baseSvgPath}" fill="none" stroke="#000000" stroke-width="0.5" vector-effect="non-scaling-stroke" />`;
        svgHTML += `<path class="marching-ants" d="${transformData.baseSvgPath}" fill="none" stroke="#ffffff" stroke-width="0.3" stroke-dasharray="6,2" vector-effect="non-scaling-stroke" />`;
        svgHTML += `</g>`;
    }

    svgHTML += `<rect x="${-bw / 2}" y="${-bh / 2}" width="${bw}" height="${bh}" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="1" vector-effect="non-scaling-stroke" />`;

    const drawHandle = (hx, hy) => {
        const rOuter = 5.0 * invScale;
        const rBlack = 3.8 * invScale;
        const rInner = 1.5 * invScale;
        return `
            <circle cx="${hx}" cy="${hy}" r="${rOuter}" fill="#ffffff" />
            <circle cx="${hx}" cy="${hy}" r="${rBlack}" fill="#000000" />
            <circle cx="${hx}" cy="${hy}" r="${rInner}" fill="#ffffff" />
        `;
    };

    svgHTML += drawHandle(-bw / 2, -bh / 2);
    svgHTML += drawHandle(0, -bh / 2);
    svgHTML += drawHandle(bw / 2, -bh / 2);
    svgHTML += drawHandle(-bw / 2, 0);
    svgHTML += drawHandle(bw / 2, 0);
    svgHTML += drawHandle(-bw / 2, bh / 2);
    svgHTML += drawHandle(0, bh / 2);
    svgHTML += drawHandle(bw / 2, bh / 2);

    svgHTML += `</g>`;
    transformGroup.innerHTML = svgHTML;
}

function startTransform() {
    if (!hasSelection) return;
    const bounds = getSelectionBounds();
    transformData = {
        x: bounds.x, y: bounds.y,
        w: bounds.w, h: bounds.h,
        origW: bounds.w, origH: bounds.h,
        baseW: bounds.w, baseH: bounds.h, // YENİ EKLENDİ: İlk şeklin gerçek boyutunu donduruyoruz
        angle: 0, scaleX: 1, scaleY: 1,
        canvas: document.createElement('canvas'),
        maskCanvas: document.createElement('canvas'),
        isDragging: false
    };
    transformData.canvas.width = bounds.w;
    transformData.canvas.height = bounds.h;
    transformData.maskCanvas.width = bounds.w;
    transformData.maskCanvas.height = bounds.h;

    const tCtx = transformData.canvas.getContext('2d');
    const mCtx = transformData.maskCanvas.getContext('2d');
    const mImg = mCtx.createImageData(bounds.w, bounds.h);

    const actCtx = getActiveCtx();
    const imgData = actCtx.getImageData(bounds.x, bounds.y, bounds.w, bounds.h);

    for (let y = 0; y < bounds.h; y++) {
        for (let x = 0; x < bounds.w; x++) {
            const maskVal = selectionMask[(bounds.y + y) * SKIN_RES + (bounds.x + x)];
            if (!maskVal) {
                imgData.data[(y * bounds.w + x) * 4 + 3] = 0;
            } else {
                const mIdx = (y * bounds.w + x) * 4;
                mImg.data[mIdx] = 255; mImg.data[mIdx + 3] = 255;
            }
        }
    }
    tCtx.putImageData(imgData, 0, 0);
    mCtx.putImageData(mImg, 0, 0);

    // YENİ: Maske canvasından SVG dış hatlarını (path) oluşturuyoruz
    transformData.baseSvgPath = generateMaskSvgPath(transformData.maskCanvas, bounds.w, bounds.h);

    for (let y = 0; y < bounds.h; y++) {
        for (let x = 0; x < bounds.w; x++) {
            if (selectionMask[(bounds.y + y) * SKIN_RES + (bounds.x + x)]) {
                actCtx.clearRect(bounds.x + x, bounds.y + y, 1, 1);
            }
        }
    }

    transformMode = true;
    selectionMask.fill(0);
    hasSelection = false;
    document.getElementById('transform-toolbar').style.display = 'flex';

    if (typeof updateSelectionVisuals === 'function') updateSelectionVisuals();
    renderComposite();
    if (typeof renderTransformVisuals === 'function') renderTransformVisuals();
}

function generateMaskSvgPath(maskCanvas, origW, origH) {
    const ctx = maskCanvas.getContext('2d', { willReadFrequently: true });
    const data = ctx.getImageData(0, 0, origW, origH).data;
    let pathD = "";
    for (let y = 0; y < origH; y++) {
        for (let x = 0; x < origW; x++) {
            const idx = (y * origW + x) * 4;
            if (data[idx + 3] > 127) {
                const px = -origW / 2 + x;
                const py = -origH / 2 + y;

                // Komşu pikselleri kontrol et (Dış hatları bulmak için)
                const up = y > 0 ? data[((y - 1) * origW + x) * 4 + 3] > 127 : false;
                const down = y < origH - 1 ? data[((y + 1) * origW + x) * 4 + 3] > 127 : false;
                const left = x > 0 ? data[(y * origW + x - 1) * 4 + 3] > 127 : false;
                const right = x < origW - 1 ? data[(y * origW + x + 1) * 4 + 3] > 127 : false;

                if (!up) pathD += `M ${px} ${py} L ${px + 1} ${py} `;
                if (!down) pathD += `M ${px} ${py + 1} L ${px + 1} ${py + 1} `;
                if (!left) pathD += `M ${px} ${py} L ${px} ${py + 1} `;
                if (!right) pathD += `M ${px + 1} ${py} L ${px + 1} ${py + 1} `;
            }
        }
    }
    return pathD;
}

function applyTransform() {
    if (!transformMode) return;
    const actCtx = getActiveCtx();
    
    const cx = transformData.x + transformData.w/2;
    const cy = transformData.y + transformData.h/2;
    
    // 1. ADIM: Maske alanındaki tüm pikselleri (saydamlar dahil) alttaki katmandan sil (Delik aç)
    if (transformData.maskCanvas) {
        actCtx.save();
        actCtx.imageSmoothingEnabled = false;
        actCtx.translate(cx, cy); 
        actCtx.rotate(transformData.angle); 
        actCtx.scale(transformData.scaleX, transformData.scaleY);
        actCtx.globalCompositeOperation = 'destination-out';
        actCtx.drawImage(transformData.maskCanvas, -transformData.w/2, -transformData.h/2, transformData.w, transformData.h);
        actCtx.restore();
    }

    // 2. ADIM: Taşınan pikselleri az önce açılan deliğin üzerine tam olarak oturt
    actCtx.save();
    actCtx.imageSmoothingEnabled = false;
    actCtx.translate(cx, cy); 
    actCtx.rotate(transformData.angle); 
    actCtx.scale(transformData.scaleX, transformData.scaleY);
    actCtx.globalCompositeOperation = 'source-over';
    actCtx.drawImage(transformData.canvas, -transformData.w/2, -transformData.h/2, transformData.w, transformData.h);
    actCtx.restore();
    
    // YENİ: 3. ADIM: Yansımayı (Mirror) Kalıcı Olarak Uygula
    if (typeof getMirroredPixel === 'function' && typeof mirrorMode !== 'undefined' && mirrorMode > 0) {
        if (!window.mirrorTempMask) {
            window.mirrorTempMask = document.createElement('canvas');
            window.mirrorTempImg = document.createElement('canvas');
            window.mirrorTempMaskCtx = window.mirrorTempMask.getContext('2d', {willReadFrequently: true});
            window.mirrorTempImgCtx = window.mirrorTempImg.getContext('2d', {willReadFrequently: true});
        }
        window.mirrorTempMask.width = SKIN_RES; window.mirrorTempImg.width = SKIN_RES;
        const mCtx = window.mirrorTempMaskCtx; const iCtx = window.mirrorTempImgCtx;
        
        mCtx.clearRect(0,0,SKIN_RES,SKIN_RES); iCtx.clearRect(0,0,SKIN_RES,SKIN_RES);
        
        mCtx.imageSmoothingEnabled = false;
        mCtx.translate(cx, cy); mCtx.rotate(transformData.angle); mCtx.scale(transformData.scaleX, transformData.scaleY);
        mCtx.drawImage(transformData.maskCanvas, -transformData.w/2, -transformData.h/2, transformData.w, transformData.h);
        mCtx.setTransform(1,0,0,1,0,0);
        
        iCtx.imageSmoothingEnabled = false;
        iCtx.translate(cx, cy); iCtx.rotate(transformData.angle); iCtx.scale(transformData.scaleX, transformData.scaleY);
        iCtx.drawImage(transformData.canvas, -transformData.w/2, -transformData.h/2, transformData.w, transformData.h);
        iCtx.setTransform(1,0,0,1,0,0);
        
        const mData = mCtx.getImageData(0,0,SKIN_RES,SKIN_RES).data;
        const iData = iCtx.getImageData(0,0,SKIN_RES,SKIN_RES).data;
        const actImg = actCtx.getImageData(0,0,SKIN_RES,SKIN_RES);
        const aData = actImg.data;
        
        for(let y=0; y<SKIN_RES; y++){
            for(let x=0; x<SKIN_RES; x++){
                const idx = (y*SKIN_RES+x)*4;
                if(mData[idx+3] > 0){
                    const mirrored = getMirroredPixel(x, y);
                    if(mirrored){
                        const mIdx = (mirrored[1]*SKIN_RES+mirrored[0])*4;
                        aData[mIdx] = 0; aData[mIdx+1] = 0; aData[mIdx+2] = 0; aData[mIdx+3] = 0;
                        if(iData[idx+3] > 0){
                            aData[mIdx] = iData[idx]; aData[mIdx+1] = iData[idx+1]; aData[mIdx+2] = iData[idx+2]; aData[mIdx+3] = iData[idx+3];
                        }
                    }
                }
            }
        }
        actCtx.putImageData(actImg, 0, 0);
    }
    
    // Taşınan alanı onayladıktan sonra karmaşık şekli (seçimi) geri getir
    if (transformData.maskCanvas) {
        const tempMaskCanvas = document.createElement('canvas');
        tempMaskCanvas.width = SKIN_RES; tempMaskCanvas.height = SKIN_RES;
        const tCtx = tempMaskCanvas.getContext('2d');
        tCtx.imageSmoothingEnabled = false;
        tCtx.translate(cx, cy); tCtx.rotate(transformData.angle); tCtx.scale(transformData.scaleX, transformData.scaleY);
        tCtx.drawImage(transformData.maskCanvas, -transformData.w/2, -transformData.h/2, transformData.w, transformData.h);
        
        const mData = tCtx.getImageData(0,0,SKIN_RES,SKIN_RES).data;
        selectionMask.fill(0);
        hasSelection = false;
        for(let i=0; i<SKIN_RES*SKIN_RES; i++) {
            if(mData[i*4 + 3] > 127) {
                selectionMask[i] = 1;
                hasSelection = true;
            }
        }
    }
    
    transformMode = false;
    document.getElementById('transform-toolbar').style.display = 'none';
    document.getElementById('editor-2d-transform').getContext('2d').clearRect(0, 0, 512, 512);
    
    renderTransformVisuals(); 
    if (typeof updateSelectionVisuals === 'function') updateSelectionVisuals(); 
    
    renderComposite(); 
    saveHistory(); 
    
    if (activeTool === 'transform') {
        setTool('rect_select'); 
    }
}

function cancelTransform() {
    if (!transformMode) return;
    if (transformData.originalPixels) {
        getActiveCtx().putImageData(transformData.originalPixels, 0, 0);
        renderComposite();
    }
    transformMode = false;
    document.getElementById('transform-toolbar').style.display = 'none';
    document.getElementById('editor-2d-transform').getContext('2d').clearRect(0, 0, 512, 512);

    renderTransformVisuals(); // YENİ EKLENDİ: SVG katmanındaki çizgileri anında temizler

    setTool('brush');
}

function copySelectionToClipboard() {
    isLatestCopyInternal = true;

    let copyCanvas;
    let copyMaskCanvas = document.createElement('canvas');
    let origX = 0, origY = 0; // YENİ: Konum hafızası

    if (transformMode) {
        copyCanvas = document.createElement('canvas');
        copyCanvas.width = transformData.canvas.width;
        copyCanvas.height = transformData.canvas.height;
        copyCanvas.getContext('2d').drawImage(transformData.canvas, 0, 0);

        copyMaskCanvas.width = transformData.maskCanvas.width;
        copyMaskCanvas.height = transformData.maskCanvas.height;
        copyMaskCanvas.getContext('2d').drawImage(transformData.maskCanvas, 0, 0);

        origX = transformData.x;
        origY = transformData.y;
    } else {
        let bounds = getSelectionBounds();
        let isFullLayer = false;

        if (!bounds) {
            bounds = { x: 0, y: 0, w: SKIN_RES, h: SKIN_RES };
            isFullLayer = true;
        }

        origX = bounds.x;
        origY = bounds.y;

        copyCanvas = document.createElement('canvas');
        copyCanvas.width = bounds.w;
        copyCanvas.height = bounds.h;
        copyMaskCanvas.width = bounds.w;
        copyMaskCanvas.height = bounds.h;

        const tempCtx = copyCanvas.getContext('2d');
        const mCtx = copyMaskCanvas.getContext('2d');

        const actCtx = getActiveCtx();
        const imgData = actCtx.getImageData(bounds.x, bounds.y, bounds.w, bounds.h);
        const mImg = mCtx.createImageData(bounds.w, bounds.h);

        for (let y = 0; y < bounds.h; y++) {
            for (let x = 0; x < bounds.w; x++) {
                const isSel = isFullLayer ? true : selectionMask[(bounds.y + y) * SKIN_RES + (bounds.x + x)];
                if (!isSel) {
                    imgData.data[(y * bounds.w + x) * 4 + 3] = 0;
                } else {
                    const mIdx = (y * bounds.w + x) * 4;
                    mImg.data[mIdx] = 255; mImg.data[mIdx + 3] = 255;
                }
            }
        }
        tempCtx.putImageData(imgData, 0, 0);
        mCtx.putImageData(mImg, 0, 0);
    }

    // YENİ: Koordinatları clipboard objesine kaydediyoruz
    clipboardData = { canvas: copyCanvas, maskCanvas: copyMaskCanvas, w: copyCanvas.width, h: copyCanvas.height, origX: origX, origY: origY };

    try {
        copyCanvas.toBlob(blob => {
            if (blob) {
                const item = new ClipboardItem({ 'image/png': blob });
                navigator.clipboard.write([item]).catch(err => {
                    console.warn("İşletim sistemine kopyalama reddedildi:", err);
                });
            }
        }, 'image/png');
    } catch (err) {
        console.warn("Clipboard API hatası:", err);
    }
}

function pasteClipboard() {
    if (!clipboardData) return;
    if (transformMode) applyTransform();

    if (!is2DMode) {
        document.getElementById('btn-view-2d').click();
    }

    let px = SKIN_RES / 2;
    let py = SKIN_RES / 2;

    const rect = renderCanvas.getBoundingClientRect();
    if (rect.width > 0) {
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        let calcX = Math.floor((cx - rect.left) / rect.width * SKIN_RES);
        let calcY = Math.floor((cy - rect.top) / rect.height * SKIN_RES);
        if (calcX >= 0 && calcX <= SKIN_RES && calcY >= 0 && calcY <= SKIN_RES && !isNaN(calcX) && !isNaN(calcY)) {
            px = calcX;
            py = calcY;
        }

        // YENİ: Kopyalanan parçanın orijinal koordinatları hafızadaysa
        if (clipboardData.origX !== undefined && clipboardData.origY !== undefined) {
            // Parçanın ekranda çizileceği gerçek pixel kutusunu (bounding box) hesapla
            const tlX = rect.left + (clipboardData.origX / SKIN_RES) * rect.width;
            const tlY = rect.top + (clipboardData.origY / SKIN_RES) * rect.height;
            const brX = rect.left + ((clipboardData.origX + clipboardData.w) / SKIN_RES) * rect.width;
            const brY = rect.top + ((clipboardData.origY + clipboardData.h) / SKIN_RES) * rect.height;

            // Eğer parçanın kutusu, kullanıcının o anki ekranı (viewport) ile çakışıyorsa (görünüyorsa)
            const isVisible = (tlX < window.innerWidth && brX > 0 && tlY < window.innerHeight && brY > 0);

            if (isVisible) {
                // Konumu, parçanın orijinal koordinatlarına zorla (Yerine Yapıştır - Paste in Place)
                px = clipboardData.origX + clipboardData.w / 2;
                py = clipboardData.origY + clipboardData.h / 2;
            }
        }
    }

    transformData.canvas = clipboardData.canvas;

    // Maske kontrolü (Dışarıdan saydam bir resim kopyalandığında hata vermemesi için güvenlik)
    if (clipboardData.maskCanvas) {
        transformData.maskCanvas = clipboardData.maskCanvas;
    } else {
        transformData.maskCanvas = document.createElement('canvas');
        transformData.maskCanvas.width = clipboardData.w;
        transformData.maskCanvas.height = clipboardData.h;
        const mCtx = transformData.maskCanvas.getContext('2d');
        mCtx.fillStyle = '#ffffff';
        mCtx.fillRect(0, 0, clipboardData.w, clipboardData.h);
    }

    transformData.w = clipboardData.w; transformData.h = clipboardData.h;
    transformData.origW = clipboardData.w; transformData.origH = clipboardData.h;
    transformData.baseW = clipboardData.w; transformData.baseH = clipboardData.h;
    transformData.x = Math.floor(px - clipboardData.w / 2);
    transformData.y = Math.floor(py - clipboardData.h / 2);
    transformData.scaleX = 1; transformData.scaleY = 1; transformData.angle = 0;
    transformData.originalPixels = null;

    if (typeof generateMaskSvgPath === 'function') {
        transformData.baseSvgPath = generateMaskSvgPath(transformData.maskCanvas, transformData.origW, transformData.origH);
    }

    transformMode = true; setTool('transform');
    document.getElementById('transform-toolbar').style.display = 'flex';
    selectionMask.fill(0); hasSelection = false;

    if (typeof updateSelectionVisuals === 'function') updateSelectionVisuals();
    if (typeof renderTransformVisuals === 'function') renderTransformVisuals();
    if (typeof renderComposite === 'function') renderComposite();
}

function cutSelectionToClipboard() {
    copySelectionToClipboard();

    if (transformMode) {
        transformMode = false;
        document.getElementById('transform-toolbar').style.display = 'none';
        document.getElementById('editor-2d-transform').getContext('2d').clearRect(0, 0, 512, 512);
        if (typeof renderTransformVisuals === 'function') renderTransformVisuals();
        renderComposite(); saveHistory(); setTool('brush'); return;
    }

    const actCtx = getActiveCtx();

    if (hasSelection) {
        const bounds = getSelectionBounds();
        const imgData = actCtx.getImageData(0, 0, SKIN_RES, SKIN_RES);
        for (let y = 0; y < bounds.h; y++) {
            for (let x = 0; x < bounds.w; x++) {
                if (selectionMask[(bounds.y + y) * SKIN_RES + (bounds.x + x)]) {
                    const i = ((bounds.y + y) * SKIN_RES + (bounds.x + x)) * 4;
                    imgData.data[i + 3] = 0; imgData.data[i + 2] = 0; imgData.data[i + 1] = 0; imgData.data[i] = 0;

                    // YENİ: Ayna açıksa, kesilen (panoya kopyalanan) alanın karşı tarafındaki pikselleri de kes(sil)
                    if (typeof getMirroredPixel === 'function' && typeof mirrorMode !== 'undefined' && mirrorMode > 0) {
                        const mirrored = getMirroredPixel(bounds.x + x, bounds.y + y);
                        if (mirrored) {
                            const mIdx = (mirrored[1] * SKIN_RES + mirrored[0]) * 4;
                            imgData.data[mIdx + 3] = 0; imgData.data[mIdx + 2] = 0; imgData.data[mIdx + 1] = 0; imgData.data[mIdx] = 0;
                        }
                    }
                }
            }
        }
        actCtx.putImageData(imgData, 0, 0);
        selectionMask.fill(0); hasSelection = false;
        if (typeof updateSelectionVisuals === 'function') updateSelectionVisuals();
        renderComposite(); saveHistory();
    }
}

document.getElementById('btn-tf-flip-h').onclick = () => { transformData.scaleX *= -1; renderTransformVisuals(); renderComposite(); };
document.getElementById('btn-tf-flip-v').onclick = () => { transformData.scaleY *= -1; renderTransformVisuals(); renderComposite(); };
document.getElementById('btn-tf-rot-ccw').onclick = () => { transformData.angle -= Math.PI / 2; renderTransformVisuals(); renderComposite(); };
document.getElementById('btn-tf-rot-cw').onclick = () => { transformData.angle += Math.PI / 2; renderTransformVisuals(); renderComposite(); };
document.getElementById('btn-tf-apply').onclick = () => applyTransform();
document.getElementById('btn-tf-cancel').onclick = () => cancelTransform();

// ==========================================================================
// === CANLI ÖNİZLEMELİ ADJUSTMENTS (AYARLAMALAR) SİSTEMİ ===
// ==========================================================================

document.getElementById('menu-adj-hue-sat').addEventListener('click', () => { closeAllMenus(); openAdjustmentWindow(winHueSat); });
document.getElementById('menu-adj-bri-con').addEventListener('click', () => { closeAllMenus(); openAdjustmentWindow(winBriCon); });

const winSepia = document.getElementById('window-sepia');
document.getElementById('menu-adj-sepia').addEventListener('click', () => { closeAllMenus(); openAdjustmentWindow(winSepia); });

const winGaussianBlur = document.getElementById('window-gaussian-blur');
document.getElementById('menu-adj-gaussian-blur').addEventListener('click', () => { closeAllMenus(); openAdjustmentWindow(winGaussianBlur); });
document.getElementById('menu-adj-resize').addEventListener('click', () => {
    closeAllMenus();
    document.getElementById('resize-skin-resolution').value = SKIN_RES === 64 ? '128' : '64';
    document.getElementById('modal-resize-skin').style.display = 'flex';
});

document.getElementById('btn-sepia-cancel').addEventListener('click', () => cancelAdjustments(winSepia));
document.getElementById('btn-sepia-ok').addEventListener('click', () => applyAdjustments(winSepia));
document.getElementById('btn-gaussian-blur-cancel').addEventListener('click', () => cancelAdjustments(winGaussianBlur));
document.getElementById('btn-gaussian-blur-ok').addEventListener('click', () => applyAdjustments(winGaussianBlur));

document.getElementById('adj-sepia').addEventListener('input', (e) => {
    document.getElementById('val-sepia').innerText = e.target.value;
    processSepia();
});
document.getElementById('adj-gaussian-blur').addEventListener('input', (e) => {
    document.getElementById('val-gaussian-blur').innerText = e.target.value;
    processGaussianBlur();
});

document.querySelectorAll('.adj-window').forEach(win => {
    const header = win.querySelector('.adj-header');
    let isDragging = false, startX, startY;

    header.addEventListener('mousedown', (e) => {
        if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
        isDragging = true;

        // Toolbar ilk açılışta translate ile ortalanır; sürüklenirken gerçek piksel konumuna geç.
        if (win.id === 'window-toolbar' && window.getComputedStyle(win).transform !== 'none') {
            win.style.top = win.getBoundingClientRect().top + 'px';
            win.style.transform = 'none';
        }
        
        // YENİ: Pencerede 'bottom' hizalaması varsa, bunu anında 'top' hizalamasına çevir.
        // Bu sayede taşıma sırasında pencerenin boyu uzamaz.
        if (win.style.bottom && win.style.bottom !== 'auto' && win.style.bottom !== '') {
            win.style.top = win.offsetTop + 'px';
            win.style.bottom = 'auto';
        }

        startX = e.clientX - win.offsetLeft;
        startY = e.clientY - win.offsetTop;
        document.querySelectorAll('.adj-window, .ref-window').forEach(w => w.style.zIndex = 1500);
        win.style.zIndex = 15001;
    });

    window.addEventListener('mousemove', (e) => {
        if (isDragging) { win.style.left = (e.clientX - startX) + 'px'; win.style.top = (e.clientY - startY) + 'px'; }
    });

    window.addEventListener('mouseup', () => {
        if (isDragging) schedulePreferencesSave();
        isDragging = false;
    });

    const closeBtn = win.querySelector('.adj-close-btn');
    if(closeBtn && win.id !== 'window-layer-props') {
        closeBtn.addEventListener('click', () => { 
            // YENİ: Araç pencerelerini ayarlardan (adjustments) ayırdık
            if (win.classList.contains('tool-window')) {
                win.style.display = 'none';
                if (typeof updateMenuStates === 'function') updateMenuStates();
            } else {
                cancelAdjustments(win); 
            }
        });
    }
});

function openAdjustmentWindow(win) {
    if (originalStateData) return; 
    if(transformMode) applyTransform();
    // Seçimi koru, fakat fırçaya geçildiğindeki gibi mavi seçim dolgusunu gizle.
    setTool('brush');
    originalStateData = getActiveCtx().getImageData(0, 0, SKIN_RES, SKIN_RES);
    win.style.display = 'flex';
    
    if (win.id === 'window-hue-sat') {
        document.getElementById('adj-hue').value = 0; document.getElementById('val-hue').innerText = 0;
        document.getElementById('adj-sat').value = 100; document.getElementById('val-sat').innerText = 100;
        document.getElementById('adj-light').value = 0; document.getElementById('val-light').innerText = 0;
    } else if (win.id === 'window-bri-con') {
        document.getElementById('adj-bri').value = 0; document.getElementById('val-bri').innerText = 0;
        document.getElementById('adj-con').value = 0; document.getElementById('val-con').innerText = 0;
    } else if (win.id === 'window-sepia') {
        document.getElementById('adj-sepia').value = 25; 
        document.getElementById('val-sepia').innerText = 25;
        processSepia(); 
    } else if (win.id === 'window-gaussian-blur') {
        document.getElementById('adj-gaussian-blur').value = 2;
        document.getElementById('val-gaussian-blur').innerText = 2;
        processGaussianBlur();
    }
}

function cancelAdjustments(win) {
    if (originalStateData) {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = SKIN_RES; tempCanvas.height = SKIN_RES;
        tempCanvas.getContext('2d').putImageData(originalStateData, 0, 0);

        getActiveCtx().clearRect(0, 0, SKIN_RES, SKIN_RES);
        getActiveCtx().drawImage(tempCanvas, 0, 0);
        renderComposite();
    }
    win.style.display = 'none';
    originalStateData = null;
}

function applyAdjustments(win) {
    if (originalStateData) {
        if (typeof saveHistory === 'function') saveHistory();
    }
    win.style.display = 'none';
    originalStateData = null;
}

document.getElementById('btn-hue-cancel').addEventListener('click', () => cancelAdjustments(winHueSat));
document.getElementById('btn-bri-cancel').addEventListener('click', () => cancelAdjustments(winBriCon));
document.getElementById('btn-hue-ok').addEventListener('click', () => applyAdjustments(winHueSat));
document.getElementById('btn-bri-ok').addEventListener('click', () => applyAdjustments(winBriCon));

document.getElementById('btn-resize-skin-cancel').addEventListener('click', () => {
    document.getElementById('modal-resize-skin').style.display = 'none';
});
document.getElementById('btn-resize-skin-apply').addEventListener('click', () => {
    const targetRes = parseInt(document.getElementById('resize-skin-resolution').value, 10);
    if (targetRes !== SKIN_RES) resizeSkinNearestNeighbor(targetRes);
    document.getElementById('modal-resize-skin').style.display = 'none';
});

function resizeSkinNearestNeighbor(targetRes) {
    if (![64, 128].includes(targetRes) || targetRes === SKIN_RES) return;
    if (transformMode) cancelTransform();

    layers.forEach(layer => {
        const source = document.createElement('canvas');
        source.width = SKIN_RES; source.height = SKIN_RES;
        const sourceCtx = source.getContext('2d');
        sourceCtx.imageSmoothingEnabled = false;
        sourceCtx.drawImage(layer.canvas, 0, 0);

        layer.canvas.width = targetRes;
        layer.canvas.height = targetRes;
        layer.ctx = layer.canvas.getContext('2d', { willReadFrequently: true });
        layer.ctx.imageSmoothingEnabled = false;
        layer.ctx.drawImage(source, 0, 0, targetRes, targetRes);
    });

    SKIN_RES = targetRes;
    canvas2d.width = SKIN_RES;
    canvas2d.height = SKIN_RES;
    ctx2d.imageSmoothingEnabled = false;
    window.cachedImageData = null;
    selectionMask = new Uint8Array(SKIN_RES * SKIN_RES);
    hasSelection = false;
    rectSelData = null;
    updateSelectionVisuals();
    renderComposite();
    updateLayerUI();
    applyLiveTexture(currentModel);

    // Farklı çözünürlükteki eski kayıtlar geri yüklenemez; yeni geçmişi başlat.
    historyData = []; historyStep = -1;
    saveHistory();
    saveCurrentDocumentState();
}

['adj-hue', 'adj-sat', 'adj-light'].forEach(id => {
    document.getElementById(id).addEventListener('input', (e) => {
        document.getElementById('val-' + id.split('-')[1]).innerText = e.target.value;
        processHueSaturation();
    });
});

['adj-bri', 'adj-con'].forEach(id => {
    document.getElementById(id).addEventListener('input', (e) => {
        document.getElementById('val-' + id.split('-')[1]).innerText = e.target.value;
        processBrightnessContrast();
    });
});

function processHueSaturation() {
    if (!originalStateData) return;
    const hVal = parseInt(document.getElementById('adj-hue').value) / 360;
    const sVal = parseInt(document.getElementById('adj-sat').value) / 100;
    const lVal = parseInt(document.getElementById('adj-light').value) / 100;

    const imgData = new ImageData(new Uint8ClampedArray(originalStateData.data), SKIN_RES, SKIN_RES);
    const data = imgData.data;

    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue;
        if (hasSelection && !selectionMask[i / 4]) continue;

        let hsl = rgbToHslObj(data[i], data[i + 1], data[i + 2]);

        hsl.h += hVal;
        if (hsl.h < 0) hsl.h += 1;
        if (hsl.h > 1) hsl.h -= 1;

        hsl.s *= sVal;
        hsl.s = Math.max(0, Math.min(1, hsl.s));

        if (lVal > 0) {
            hsl.l += lVal * (1 - hsl.l);
        } else {
            hsl.l += lVal * hsl.l;
        }
        hsl.l = Math.max(0, Math.min(1, hsl.l));

        let rgb = hslToRgbArr(hsl.h, hsl.s, hsl.l);
        data[i] = rgb[0];
        data[i + 1] = rgb[1];
        data[i + 2] = rgb[2];
    }

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = SKIN_RES; tempCanvas.height = SKIN_RES;
    tempCanvas.getContext('2d').putImageData(imgData, 0, 0);

    getActiveCtx().clearRect(0, 0, SKIN_RES, SKIN_RES);
    getActiveCtx().drawImage(tempCanvas, 0, 0);
    renderComposite();
}

function processBrightnessContrast() {
    if (!originalStateData) return;
    const bri = parseInt(document.getElementById('adj-bri').value);
    const con = parseInt(document.getElementById('adj-con').value);

    const brightness = Math.round((bri / 100) * 255);
    const factor = (259 * (con + 255)) / (255 * (259 - con));

    const imgData = new ImageData(new Uint8ClampedArray(originalStateData.data), SKIN_RES, SKIN_RES);
    const data = imgData.data;

    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue;
        if (hasSelection && !selectionMask[i / 4]) continue;

        for (let j = 0; j < 3; j++) {
            let c = data[i + j];
            c = factor * (c - 128) + 128;
            c += brightness;
            data[i + j] = Math.max(0, Math.min(255, c));
        }
    }

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = SKIN_RES; tempCanvas.height = SKIN_RES;
    tempCanvas.getContext('2d').putImageData(imgData, 0, 0);

    getActiveCtx().clearRect(0, 0, SKIN_RES, SKIN_RES);
    getActiveCtx().drawImage(tempCanvas, 0, 0);
    renderComposite();
}

function processGaussianBlur() {
    if (!originalStateData) return;
    const radius = parseInt(document.getElementById('adj-gaussian-blur').value, 10);
    const source = originalStateData.data;
    const output = new Uint8ClampedArray(source);
    if (radius <= 0) {
        const image = new ImageData(output, SKIN_RES, SKIN_RES);
        getActiveCtx().putImageData(image, 0, 0);
        renderComposite();
        return;
    }

    // Paint.NET tarzı Gaussian blur: iki geçişli, normal dağılımlı çekirdek.
    const sigma = Math.max(0.5, radius / 2);
    const kernelRadius = Math.ceil(sigma * 3);
    const kernel = [];
    let total = 0;
    for (let i = -kernelRadius; i <= kernelRadius; i++) {
        const value = Math.exp(-(i * i) / (2 * sigma * sigma));
        kernel.push(value); total += value;
    }
    for (let i = 0; i < kernel.length; i++) kernel[i] /= total;

    // Premultiplied alpha ile hesaplama, saydam kenarlarda koyu saçak oluşmasını engeller.
    const horizontal = new Float32Array(SKIN_RES * SKIN_RES * 4);
    for (let y = 0; y < SKIN_RES; y++) {
        for (let x = 0; x < SKIN_RES; x++) {
            let r = 0, g = 0, b = 0, a = 0;
            for (let k = -kernelRadius; k <= kernelRadius; k++) {
                const sx = Math.max(0, Math.min(SKIN_RES - 1, x + k));
                const index = (y * SKIN_RES + sx) * 4;
                const weight = kernel[k + kernelRadius];
                const alpha = source[index + 3] / 255;
                r += source[index] * alpha * weight;
                g += source[index + 1] * alpha * weight;
                b += source[index + 2] * alpha * weight;
                a += alpha * weight;
            }
            const outIndex = (y * SKIN_RES + x) * 4;
            horizontal[outIndex] = r; horizontal[outIndex + 1] = g;
            horizontal[outIndex + 2] = b; horizontal[outIndex + 3] = a;
        }
    }

    for (let y = 0; y < SKIN_RES; y++) {
        for (let x = 0; x < SKIN_RES; x++) {
            let r = 0, g = 0, b = 0, a = 0;
            for (let k = -kernelRadius; k <= kernelRadius; k++) {
                const sy = Math.max(0, Math.min(SKIN_RES - 1, y + k));
                const index = (sy * SKIN_RES + x) * 4;
                const weight = kernel[k + kernelRadius];
                r += horizontal[index] * weight;
                g += horizontal[index + 1] * weight;
                b += horizontal[index + 2] * weight;
                a += horizontal[index + 3] * weight;
            }
            const outIndex = (y * SKIN_RES + x) * 4;
            if (!hasSelection || selectionMask[y * SKIN_RES + x]) {
                output[outIndex] = a > 0 ? Math.round(r / a) : 0;
                output[outIndex + 1] = a > 0 ? Math.round(g / a) : 0;
                output[outIndex + 2] = a > 0 ? Math.round(b / a) : 0;
                output[outIndex + 3] = Math.round(a * 255);
            }
        }
    }

    getActiveCtx().putImageData(new ImageData(output, SKIN_RES, SKIN_RES), 0, 0);
    renderComposite();
}

// === DIŞARIDAN VEYA İÇERİDEN GÖRÜNTÜ YAPIŞTIRMA (PASTE) ===
window.addEventListener('paste', (e) => {
    // Yazı yazılan bir input içindeysek yapıştırmayı engelleme
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    // YENİ: Kopyalama içeriden yapıldıysa ve başka programa geçilmediyse, bozuk sistem PNG'sini yok say!
    if (typeof isLatestCopyInternal !== 'undefined' && isLatestCopyInternal && clipboardData) {
        e.preventDefault();
        pasteClipboard();
        return;
    }

    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    let externalImagePasted = false;

    if (items) {
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                const blob = items[i].getAsFile();
                const reader = new FileReader();
                reader.onload = (event) => {
                    const img = new Image();
                    img.onload = () => {
                        const tempCanvas = document.createElement('canvas');
                        tempCanvas.width = img.width;
                        tempCanvas.height = img.height;
                        const tCtx = tempCanvas.getContext('2d');
                        tCtx.imageSmoothingEnabled = false;
                        tCtx.drawImage(img, 0, 0);

                        // Maske canvası (şekle göre) oluştur
                        const maskCanvas = document.createElement('canvas');
                        maskCanvas.width = img.width; maskCanvas.height = img.height;
                        const mCtx = maskCanvas.getContext('2d');
                        const mImg = mCtx.createImageData(img.width, img.height);
                        const tImg = tCtx.getImageData(0, 0, img.width, img.height).data;

                        let hasOpaque = false;
                        for (let i = 0; i < tImg.length; i += 4) {
                            if (tImg[i + 3] > 0) { // Görünür pikselleri seç
                                mImg.data[i] = 255; mImg.data[i + 3] = 255;
                                hasOpaque = true;
                            }
                        }

                        // YENİ: Eğer yapıştırılan resim tamamen saydamsa, boş maske vermek yerine tüm şekli (dörtgeni) maskele
                        if (!hasOpaque) {
                            for (let i = 0; i < tImg.length; i += 4) {
                                mImg.data[i] = 255; mImg.data[i + 3] = 255;
                            }
                        }

                        mCtx.putImageData(mImg, 0, 0);

                        clipboardData = { canvas: tempCanvas, maskCanvas: maskCanvas, w: img.width, h: img.height };
                        pasteClipboard();
                    };
                    img.src = event.target.result;
                };
                reader.readAsDataURL(blob);
                externalImagePasted = true;
                e.preventDefault();
                break;
            }
        }
    }

    // Eğer dışarıdan bir resim gelmediyse ve uygulama içinde kopyaladığımız bir şey varsa onu yapıştırır
    if (!externalImagePasted && clipboardData) {
        e.preventDefault();
        pasteClipboard();
    }
});

// === MASAÜSTÜNDEN DOSYA SÜRÜKLE BIRAK (Paint.NET Tarzı) ===
let isInternalDrag = false;
let pendingDroppedFiles = [];

function readImageFile(file, onLoad) {
    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => onLoad(img);
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
}

function showDropImportModal() {
    const file = pendingDroppedFiles[0];
    if (!file) return;

    const remaining = pendingDroppedFiles.length - 1;
    document.getElementById('drop-import-message').textContent = remaining > 0
        ? `“${file.name}” için bir işlem seçin. Sırada ${remaining} dosya daha var.`
        : `“${file.name}” için bir işlem seçin.`;
    document.getElementById('modal-drop-import').style.display = 'flex';
}

function finishDroppedFileChoice() {
    pendingDroppedFiles.shift();
    if (pendingDroppedFiles.length > 0) showDropImportModal();
}

function canvasBlendModeFromPdn(blendMode) {
    const modes = {
        normal: 'source-over', multiply: 'multiply', additive: 'lighter', colorburn: 'color-burn',
        colordodge: 'color-dodge', darken: 'darken', lighten: 'lighten', overlay: 'overlay',
        screen: 'screen', difference: 'difference', exclusion: 'exclusion', hardlight: 'hard-light',
        softlight: 'soft-light'
    };
    return modes[String(blendMode || 'normal').replace(/[^a-z]/gi, '').toLowerCase()] || 'source-over';
}

function openPdnDocument(file, onComplete = null) {
    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const apiBaseUrl = (window.PDN_API_URL || '').replace(/\/$/, '');
            if (!apiBaseUrl && location.hostname !== '127.0.0.1' && location.hostname !== 'localhost') {
                throw new Error('PDN servisi henüz yapılandırılmadı.');
            }
            const response = await fetch(`${apiBaseUrl}/api/open-pdn`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fileName: file.name, data: event.target.result.split(',')[1] })
            });
            const pdn = await response.json();
            if (!response.ok) throw new Error(pdn.error || 'PDN dosyası okunamadı.');

            const res = (pdn.width === 128 || pdn.height === 128) ? 128 : 64;
            const layerImages = await Promise.all(pdn.layers.map(layer => new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = () => resolve({ ...layer, image });
                image.onerror = reject;
                image.src = layer.image;
            })));

            createNewDocument(file.name.replace(/\.[^/.]+$/, ''), null, res, 'default');
            layers = layerImages.reverse().map(layerData => {
                const layer = createLayerObj(layerData.name || 'Layer');
                layer.visible = layerData.visible !== false;
                layer.opacity = Number.isFinite(layerData.opacity) ? layerData.opacity : 255;
                layer.blendMode = canvasBlendModeFromPdn(layerData.blendMode);
                layer.ctx.drawImage(layerData.image, 0, 0, SKIN_RES, SKIN_RES);
                return layer;
            });
            activeLayerIndex = 0;
            historyData = []; historyStep = -1;
            updateLayerUI(); renderComposite(); saveHistory(); saveCurrentDocumentState();
            if (onComplete) onComplete();
        } catch (error) {
            console.error('PDN açma hatası:', error);
            alert(`PDN dosyası açılamadı: ${error.message}`);
            if (onComplete) onComplete();
        }
    };
    reader.readAsDataURL(file);
}

function openDroppedFile(file) {
    if (file.name.toLowerCase().endsWith('.pdn')) {
        openPdnDocument(file, finishDroppedFileChoice);
        return;
    }
    readImageFile(file, (img) => {
        const res = (img.width === 128 || img.height === 128) ? 128 : 64;
        const name = file.name.replace(/\.[^/.]+$/, '');
        createNewDocument(name, img, res, detectSkinModel(img, res));
        finishDroppedFileChoice();
    });
}

function addDroppedFileAsLayer(file) {
    readImageFile(file, (img) => {
        if (typeof transformMode !== 'undefined' && transformMode) applyTransform();
        const layer = createLayerObj(file.name.replace(/\.[^/.]+$/, ''));
        layer.ctx.drawImage(img, 0, 0, SKIN_RES, SKIN_RES);
        layers.splice(activeLayerIndex, 0, layer);
        activeLayerIndex = layers.indexOf(layer);
        updateLayerUI();
        renderComposite();
        saveHistory();
        finishDroppedFileChoice();
    });
}

document.getElementById('btn-drop-import-open').addEventListener('click', () => {
    const file = pendingDroppedFiles[0];
    if (!file) return;
    document.getElementById('modal-drop-import').style.display = 'none';
    openDroppedFile(file);
});

document.getElementById('btn-drop-import-layer').addEventListener('click', () => {
    const file = pendingDroppedFiles[0];
    if (!file) return;
    document.getElementById('modal-drop-import').style.display = 'none';
    if (file.name.toLowerCase().endsWith('.pdn')) {
        alert('PDN dosyaları katman yapılarını korumak için “Dosya Aç” seçeneğiyle açılır.');
        finishDroppedFileChoice();
        return;
    }
    addDroppedFileAsLayer(file);
});

document.getElementById('btn-drop-import-cancel').addEventListener('click', () => {
    pendingDroppedFiles = [];
    document.getElementById('modal-drop-import').style.display = 'none';
});

window.addEventListener('dragstart', (e) => {
    // Editör içindeki sekmeler veya katmanlar sürüklenirken burası tetiklenir
    isInternalDrag = true;
});

window.addEventListener('dragend', (e) => {
    // İçerideki sürükleme bittiğinde güvenlik kilidini açar
    isInternalDrag = false;
});

window.addEventListener('dragover', (e) => {
    if (isInternalDrag) return; // İç sürüklemelerde varsayılan tepkiyi atla
    if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    }
});

window.addEventListener('drop', (e) => {
    // YENİ EKLENDİ: Eğer sürüklenen şey kendi sekmemiz/katmanımız ise, yeni dosya açmayı iptal et!
    if (isInternalDrag) return;

    if (!e.dataTransfer || !e.dataTransfer.files || e.dataTransfer.files.length === 0) return;

    const imageFiles = Array.from(e.dataTransfer.files).filter(file => file.type.startsWith('image/') || file.name.toLowerCase().endsWith('.pdn'));
    if (imageFiles.length === 0) return;

    e.preventDefault();
    pendingDroppedFiles.push(...imageFiles);
    if (document.getElementById('modal-drop-import').style.display !== 'flex') showDropImportModal();
});
// YENİ: Sepya Filtresi İşleme Fonksiyonu
function processSepia() {
    if (!originalStateData) return;
    const intensity = parseInt(document.getElementById('adj-sepia').value) / 100;

    const imgData = new ImageData(new Uint8ClampedArray(originalStateData.data), SKIN_RES, SKIN_RES);
    const data = imgData.data;

    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue; // Saydam pikselleri atla
        // Alan seçiliyse ve bu piksel seçimin dışındaysa atla
        if (hasSelection && !selectionMask[i / 4]) continue; 

        const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
        // Paint.NET görünümünde orta tonlar nötr kalır; yalnızca parlaklığa göre
        // kontrollü sıcaklık eklenir. Klasik 3x3 matris açık tonları fazla sarı
        // ve beyaz yaptığından burada parlaklık tabanlı sepya eğrisi kullanılır.
        const gray = r * 0.299 + g * 0.587 + b * 0.114;
        const shadow = Math.pow(1 - gray / 255, 0.45);
        const sepiaR = Math.min(255, gray + 46 * shadow);
        const sepiaG = gray;
        const sepiaB = Math.max(0, gray - 42 * Math.pow(1 - gray / 255, 0.55));
        // Arayüzdeki %50, Paint.NET'in eski varsayılan yoğunluğuna karşılık gelir.
        const amount = Math.min(1, intensity * 2);
        data[i] = Math.round(gray + (sepiaR - gray) * amount);
        data[i + 1] = Math.round(gray + (sepiaG - gray) * amount);
        data[i + 2] = Math.round(gray + (sepiaB - gray) * amount);
    }
    
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = SKIN_RES; tempCanvas.height = SKIN_RES;
    tempCanvas.getContext('2d').putImageData(imgData, 0, 0);
    
    getActiveCtx().clearRect(0, 0, SKIN_RES, SKIN_RES);
    getActiveCtx().drawImage(tempCanvas, 0, 0);
    if (typeof renderComposite === 'function') renderComposite();
}

// View menüsündeki tüm pencereleri yöneten güncel toggle yapısı
function toggleWindow(winId) {
    const win = document.getElementById(winId);
    if (!win) return;
    
    // Satır içi stil boş olduğunda da pencerenin gerçek görünürlüğünü kullan.
    const isVisible = window.getComputedStyle(win).display !== 'none';
    win.style.display = isVisible ? 'none' : 'flex';
    
    // Z-index'i en öne getir
    document.querySelectorAll('.adj-window, .ref-window').forEach(w => w.style.zIndex = 1500);
    win.style.zIndex = 15001;
    
    if (typeof updateMenuStates === 'function') updateMenuStates();
    schedulePreferencesSave();
    closeAllMenus();
}

document.getElementById('menu-view-toolbar').addEventListener('click', () => toggleWindow('window-toolbar'));
document.getElementById('menu-view-color').addEventListener('click', () => toggleWindow('window-color-panel'));
document.getElementById('menu-view-layers').addEventListener('click', () => toggleWindow('window-layers-panel'));

// Uygulama ilk açıldığında tikleri eşitle
window.addEventListener('load', () => {
    setTimeout(() => {
        if (typeof updateMenuStates === 'function') updateMenuStates();
    }, 200);
});
