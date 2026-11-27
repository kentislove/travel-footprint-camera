/**
 * 旅遊足跡相機核心控制腳本 (v7 iOS 連拍修復 + 非阻塞編碼版)
 *
 * v7 相較 v6 的四大修復（專治 iPhone Chrome/Safari 無法連拍）：
 * 1. 編碼非同步化：改用 canvas.toBlob() 取代 canvas.toDataURL()，JPEG 編碼
 *    丟到瀏覽器背景執行緒，主執行緒不再阻塞，快門按下後 50ms 內即可按下一張。
 * 2. iOS 安全解析度上限：偵測 iOS 時，最大邊長壓到 2560px，避免 WebView
 *    記憶體爆掉導致鏡頭串流被系統回收。
 * 3. 每張獨立 Canvas：每次拍照都 new 一組 OffscreenCanvas / document.createElement
 *    避免 v6 單一共用 canvas 被連拍覆蓋造成資料損毀。
 * 4. applyConstraints 走 iOS 相容語法：改用 { width: { ideal } } 單層格式，
 *    不用 advanced: [{ … }]；失敗時優雅退場不影響拍照。
 * 5. 預覽改走 ObjectURL：縮圖與預覽彈窗使用 URL.createObjectURL(blob)，
 *    體積 0 且 GC 友善；base64 僅在上傳 Google Drive 那一刻才現場轉。
 */

const state = {
  latitude: null,
  longitude: null,
  accuracy: null,
  address: "定位準備中...",
  activeTab: "stamped",
  mediaStream: null,
  currentTrack: null,
  currentFacingMode: "environment",
  gasUrl: localStorage.getItem("travel_camera_gas_url") || "https://script.google.com/macros/s/AKfycbxr3Zv5jRHXevBRVQdpJ1zINvYndnYtrsW6gfOg2-gGaf9pEXYWCLNkQECkirh-2X_OIw/exec",
  autoUpload: localStorage.getItem("travel_camera_auto_upload") !== "false",
  autoDownload: localStorage.getItem("travel_camera_auto_download") === "true",

  cameraCaps: {
    maxWidth: 0,
    maxHeight: 0,
    actualWidth: 0,
    actualHeight: 0,
    supportsNativeZoom: false,
    zoomMin: 1,
    zoomMax: 1,
    zoomStep: 0.1
  },

  currentZoom: 1,

  uploadQueue: [],
  isUploading: false,
  currentViewingPhoto: null
};

// 1. iOS / 裝置偵測與安全上限
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
              (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const IOS_SAFE_MAX_DIM = 2560;     // iPhone WebKit 單張安全上限
const ANDROID_SAFE_MAX_DIM = 4096; // Android Chrome 可承受更高
const JPEG_QUALITY = isIOS ? 0.90 : 0.92;

const dom = {
  gpsIndicator: document.getElementById("gpsIndicator"),
  gpsStatus: document.getElementById("gpsStatus"),
  addressDisplay: document.getElementById("addressDisplay"),
  tripTitleInput: document.getElementById("tripTitleInput"),
  cameraVideo: document.getElementById("cameraVideo"),
  cameraPromptOverlay: document.getElementById("cameraPromptOverlay"),
  btnStartCameraManual: document.getElementById("btnStartCameraManual"),
  btnSwitchCamera: document.getElementById("btnSwitchCamera"),
  shutterFlash: document.getElementById("shutterFlash"),
  quickToast: document.getElementById("quickToast"),
  cloudSyncBadge: document.getElementById("cloudSyncBadge"),
  syncText: document.getElementById("syncText"),
  btnCapture: document.getElementById("btnCapture"),
  btnRefreshGps: document.getElementById("btnRefreshGps"),
  btnSettings: document.getElementById("btnSettings"),
  settingsModal: document.getElementById("settingsModal"),
  btnCloseSettings: document.getElementById("btnCloseSettings"),
  btnSaveSettings: document.getElementById("btnSaveSettings"),
  gasUrlInput: document.getElementById("gasUrlInput"),
  autoUploadCheck: document.getElementById("autoUploadCheck"),
  autoDownloadCheck: document.getElementById("autoDownloadCheck"),

  thumbnailContainer: document.getElementById("thumbnailContainer"),
  latestThumbImg: document.getElementById("latestThumbImg"),
  thumbPlaceholder: document.getElementById("thumbPlaceholder"),
  previewModal: document.getElementById("previewModal"),
  previewImg: document.getElementById("previewImg"),
  tabStamped: document.getElementById("tabStamped"),
  tabClean: document.getElementById("tabClean"),
  btnClosePreview: document.getElementById("btnClosePreview"),
  btnSaveLocal: document.getElementById("btnSaveLocal"),
  btnForceUpload: document.getElementById("btnForceUpload"),

  resolutionBadge: document.getElementById("resolutionBadge"),
  zoomPanel: document.getElementById("zoomPanel"),
  zoomSlider: document.getElementById("zoomSlider"),
  zoomValue: document.getElementById("zoomValue"),
  btnZoomOut: document.getElementById("btnZoomOut"),
  btnZoomIn: document.getElementById("btnZoomIn")
};

window.addEventListener("DOMContentLoaded", () => {
  initSettings();
  initGeolocation();
  initEventHandlers();
  startCamera();
});

function initSettings() {
  dom.gasUrlInput.value = state.gasUrl;
  dom.autoUploadCheck.checked = state.autoUpload;
  dom.autoDownloadCheck.checked = state.autoDownload;
}

// 2. 相機啟動（iOS 相容語法）
async function startCamera() {
  stopCamera();
  let stream = null;
  const facing = state.currentFacingMode;
  const safeMax = isIOS ? IOS_SAFE_MAX_DIM : ANDROID_SAFE_MAX_DIM;

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: facing },
        width: { ideal: safeMax },
        height: { ideal: safeMax }
      },
      audio: false
    });
  } catch (e1) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing },
        audio: false
      });
    } catch (e2) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } catch (e3) {
        console.error("相機存取失敗：", e3);
        dom.cameraPromptOverlay.style.display = "flex";
        return;
      }
    }
  }

  state.mediaStream = stream;
  state.currentTrack = stream.getVideoTracks()[0];

  await applySafeMaxResolution(state.currentTrack);
  detectZoomCapability(state.currentTrack);
  refreshResolutionBadge();

  const video = dom.cameraVideo;
  video.srcObject = stream;
  video.onloadedmetadata = async () => {
    try {
      await video.play();
      dom.cameraPromptOverlay.style.display = "none";
      refreshResolutionBadge();
    } catch (e) {
      dom.cameraPromptOverlay.style.display = "flex";
    }
  };
}

async function applySafeMaxResolution(track) {
  if (!track || typeof track.getCapabilities !== "function") return;
  try {
    const caps = track.getCapabilities();
    let maxW = caps.width && caps.width.max ? caps.width.max : 0;
    let maxH = caps.height && caps.height.max ? caps.height.max : 0;
    state.cameraCaps.maxWidth = maxW;
    state.cameraCaps.maxHeight = maxH;

    const safeMax = isIOS ? IOS_SAFE_MAX_DIM : ANDROID_SAFE_MAX_DIM;
    if (maxW > safeMax || maxH > safeMax) {
      const ratio = Math.min(safeMax / maxW, safeMax / maxH);
      maxW = Math.round(maxW * ratio);
      maxH = Math.round(maxH * ratio);
    }

    if (maxW && maxH) {
      // iOS 相容：走單層 ideal，不用 advanced
      await track.applyConstraints({
        width: { ideal: maxW },
        height: { ideal: maxH }
      });
    }
  } catch (err) {
    console.warn("調整至最大解析度失敗，使用預設值：", err);
  }

  const settings = track.getSettings ? track.getSettings() : {};
  state.cameraCaps.actualWidth = settings.width || 0;
  state.cameraCaps.actualHeight = settings.height || 0;
}

function detectZoomCapability(track) {
  state.cameraCaps.supportsNativeZoom = false;
  state.cameraCaps.zoomMin = 1;
  state.cameraCaps.zoomMax = 1;
  state.cameraCaps.zoomStep = 0.1;
  state.currentZoom = 1;

  if (!track || typeof track.getCapabilities !== "function") {
    setupDigitalZoomUI();
    return;
  }
  const caps = track.getCapabilities();
  if (caps.zoom && typeof caps.zoom.max === "number" && caps.zoom.max > caps.zoom.min) {
    state.cameraCaps.supportsNativeZoom = true;
    state.cameraCaps.zoomMin = caps.zoom.min;
    state.cameraCaps.zoomMax = caps.zoom.max;
    state.cameraCaps.zoomStep = caps.zoom.step || 0.1;
    state.currentZoom = caps.zoom.min;
    setupNativeZoomUI();
  } else {
    state.cameraCaps.zoomMin = 1;
    state.cameraCaps.zoomMax = 4;
    state.cameraCaps.zoomStep = 0.1;
    state.currentZoom = 1;
    setupDigitalZoomUI();
  }
}

function setupNativeZoomUI() {
  const { zoomMin, zoomMax, zoomStep } = state.cameraCaps;
  dom.zoomPanel.style.display = "flex";
  dom.zoomSlider.min = String(zoomMin);
  dom.zoomSlider.max = String(zoomMax);
  dom.zoomSlider.step = String(zoomStep);
  dom.zoomSlider.value = String(state.currentZoom);
  updateZoomLabel();
  dom.cameraVideo.style.transform = "";
}

function setupDigitalZoomUI() {
  dom.zoomPanel.style.display = "flex";
  dom.zoomSlider.min = "1";
  dom.zoomSlider.max = "4";
  dom.zoomSlider.step = "0.1";
  dom.zoomSlider.value = "1";
  state.currentZoom = 1;
  updateZoomLabel();
  applyDigitalZoomPreview();
}

function updateZoomLabel() {
  dom.zoomValue.textContent = `${state.currentZoom.toFixed(1)}x`;
}

async function setZoom(value) {
  const z = Math.max(state.cameraCaps.zoomMin, Math.min(state.cameraCaps.zoomMax, Number(value)));
  state.currentZoom = z;
  updateZoomLabel();
  dom.zoomSlider.value = String(z);

  if (state.cameraCaps.supportsNativeZoom && state.currentTrack) {
    try {
      await state.currentTrack.applyConstraints({ advanced: [{ zoom: z }] });
    } catch (e) {
      console.warn("原生 zoom 調整失敗：", e);
    }
  } else {
    applyDigitalZoomPreview();
  }
}

function applyDigitalZoomPreview() {
  const z = state.currentZoom;
  dom.cameraVideo.style.transformOrigin = "center center";
  dom.cameraVideo.style.transform = `scale(${z})`;
}

function refreshResolutionBadge() {
  const w = state.cameraCaps.actualWidth || dom.cameraVideo.videoWidth || 0;
  const h = state.cameraCaps.actualHeight || dom.cameraVideo.videoHeight || 0;
  if (w && h) {
    const mp = ((w * h) / 1000000).toFixed(1);
    dom.resolutionBadge.textContent = `${w}×${h} (${mp}MP)`;
    dom.resolutionBadge.style.display = "inline-block";
  } else {
    dom.resolutionBadge.style.display = "none";
  }
}

function stopCamera() {
  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach(t => t.stop());
    state.mediaStream = null;
  }
  state.currentTrack = null;
  dom.cameraVideo.srcObject = null;
  dom.cameraVideo.style.transform = "";
}

function switchCamera() {
  state.currentFacingMode = (state.currentFacingMode === "environment") ? "user" : "environment";
  startCamera();
}

// 3. 定位
function initGeolocation() {
  if (!navigator.geolocation) {
    updateGpsUI(false, "手機不支援定位功能");
    return;
  }
  updateGpsUI(null, "正在抓取衛星定位中...");
  navigator.geolocation.watchPosition(
    async (pos) => {
      state.latitude = pos.coords.latitude;
      state.longitude = pos.coords.longitude;
      state.accuracy = pos.coords.accuracy;
      updateGpsUI(true, `定位成功 (誤差約 ${Math.round(pos.coords.accuracy)} 公尺)`);
      await resolveChineseAddress(pos.coords.latitude, pos.coords.longitude);
    },
    (err) => {
      let msg = "定位無法取得";
      if (err.code === 1) msg = "請允許瀏覽器位置權限";
      else if (err.code === 2) msg = "暫時收不到衛星訊號";
      else if (err.code === 3) msg = "定位逾時重試中";
      updateGpsUI(false, msg);
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 }
  );
}

function updateGpsUI(isReady, msg) {
  dom.gpsStatus.textContent = msg;
  dom.gpsIndicator.className = "status-indicator";
  if (isReady === true) dom.gpsIndicator.classList.add("ready");
  else if (isReady === false) dom.gpsIndicator.classList.add("error");
}

async function resolveChineseAddress(lat, lon) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&accept-language=zh-TW`;
    const res = await fetch(url, { headers: { "Accept-Language": "zh-TW" } });
    if (!res.ok) throw new Error("地址解析異常");
    const data = await res.json();
    if (data && data.display_name) {
      state.address = formatAddress(data);
      dom.addressDisplay.textContent = `📍 ${state.address}`;
    }
  } catch (e) {
    state.address = `座標：${lat.toFixed(5)}° N, ${lon.toFixed(5)}° E`;
    dom.addressDisplay.textContent = `📍 ${state.address}`;
  }
}

function formatAddress(data) {
  const a = data.address || {};
  const city = a.city || a.town || a.county || "";
  const dist = a.suburb || a.district || "";
  const road = a.road || "";
  const num = a.house_number ? `${a.house_number}號` : "";
  const spot = a.attraction || a.tourism || "";
  let full = `${city}${dist}${road}${num}`;
  if (spot) full += ` (${spot})`;
  return full.trim() || data.display_name;
}

// 4. ★ 核心：非阻塞連拍引擎 ★
function capturePhotoInstantly() {
  const video = dom.cameraVideo;
  if (!video.videoWidth || !video.videoHeight) {
    dom.cameraPromptOverlay.style.display = "flex";
    return;
  }

  if (navigator.vibrate) navigator.vibrate(40);
  triggerShutterFlash();

  // (A) 鎖定當下所有情境資料（避免下一張覆蓋）
  const snapshot = {
    id: Date.now() + Math.random(),
    tripTitle: dom.tripTitleInput.value.trim() || "旅遊隨手拍",
    timestamp: formatFullDate(new Date()),
    address: state.address,
    latitude: state.latitude,
    longitude: state.longitude
  };

  const origW = video.videoWidth;
  const origH = video.videoHeight;

  // (B) 計算裁切窗（數位縮放時從中心取）
  const useDigitalZoom = !state.cameraCaps.supportsNativeZoom && state.currentZoom > 1.01;
  let srcX = 0, srcY = 0, srcW = origW, srcH = origH;
  if (useDigitalZoom) {
    const z = state.currentZoom;
    srcW = Math.round(origW / z);
    srcH = Math.round(origH / z);
    srcX = Math.round((origW - srcW) / 2);
    srcY = Math.round((origH - srcH) / 2);
  }

  // (C) ★ 每次拍照獨立 canvas，不共用，連拍不互相覆蓋 ★
  const cleanCanvas = document.createElement("canvas");
  const stampedCanvas = document.createElement("canvas");
  cleanCanvas.width = srcW;
  cleanCanvas.height = srcH;
  stampedCanvas.width = srcW;
  stampedCanvas.height = srcH;

  // (D) 繪製（同步，但速度很快 ~5-30ms）
  cleanCanvas.getContext("2d").drawImage(video, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);
  const sCtx = stampedCanvas.getContext("2d");
  sCtx.drawImage(video, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);
  drawTravelStamp(sCtx, srcW, srcH, snapshot.tripTitle, snapshot.address, snapshot.timestamp, snapshot.latitude, snapshot.longitude);

  // (E) 立即給使用者回饋 → 快門可以馬上按下一張
  const mp = ((srcW * srcH) / 1000000).toFixed(1);
  showQuickToast(`✓ 已拍下 ${srcW}×${srcH} (${mp}MP)`);

  // (F) ★ 非同步編碼：toBlob 走背景執行緒，不阻塞主線 ★
  Promise.all([
    canvasToBlob(cleanCanvas, "image/jpeg", JPEG_QUALITY),
    canvasToBlob(stampedCanvas, "image/jpeg", JPEG_QUALITY)
  ]).then(([cleanBlob, stampedBlob]) => {
    const task = Object.assign({}, snapshot, {
      width: srcW,
      height: srcH,
      cleanBlob,
      stampedBlob,
      cleanUrl: URL.createObjectURL(cleanBlob),
      stampedUrl: URL.createObjectURL(stampedBlob)
    });

    updateLatestThumbnail(task);

    if (state.autoDownload) saveTaskToLocal(task, false);
    if (state.autoUpload && state.gasUrl) {
      state.uploadQueue.push(task);
      triggerBackgroundUploader();
    }
  }).catch(err => {
    console.error("編碼失敗：", err);
    showQuickToast("⚠️ 編碼失敗，請再按一次");
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    if (canvas.toBlob) {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("toBlob 回傳 null"));
      }, type, quality);
    } else {
      // 極少數不支援 toBlob 的環境退回 toDataURL
      try {
        const dataUrl = canvas.toDataURL(type, quality);
        fetch(dataUrl).then(r => r.blob()).then(resolve).catch(reject);
      } catch (e) { reject(e); }
    }
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = r.result || "";
      const comma = s.indexOf(",");
      resolve(comma >= 0 ? s.slice(comma + 1) : s);
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// 5. 背景佇列上傳（blob → base64 只在上傳當下才轉）
async function triggerBackgroundUploader() {
  updateSyncBadge();
  if (state.isUploading) return;
  state.isUploading = true;

  while (state.uploadQueue.length > 0) {
    const task = state.uploadQueue[0];
    updateSyncBadge();
    try {
      const [cleanB64, stampedB64] = await Promise.all([
        blobToBase64(task.cleanBlob),
        blobToBase64(task.stampedBlob)
      ]);
      const payload = {
        tripTitle: task.tripTitle,
        timestamp: task.timestamp,
        address: task.address,
        latitude: task.latitude,
        longitude: task.longitude,
        cleanImageBase64: cleanB64,
        stampedImageBase64: stampedB64
      };
      const res = await fetch(state.gasUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
      });
      const result = await res.json();
      if (result && result.status === "success") {
        state.uploadQueue.shift();
      } else {
        throw new Error("伺服器未回傳成功");
      }
    } catch (err) {
      console.warn("背景上傳暫時延遲，3秒後自動重試...", err);
      await sleep(3000);
    }
  }
  state.isUploading = false;
  updateSyncBadge();
}

function updateSyncBadge() {
  const count = state.uploadQueue.length;
  const badge = dom.cloudSyncBadge;
  const text = dom.syncText;
  badge.className = "sync-badge";
  if (count > 0) {
    badge.classList.add("syncing");
    text.textContent = `同步中 (${count}張)...`;
  } else {
    badge.classList.add("done");
    text.textContent = "全部已同步";
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 6. 縮圖與預覽（改走 ObjectURL）
function updateLatestThumbnail(task) {
  state.currentViewingPhoto = task;
  dom.latestThumbImg.src = task.stampedUrl;
  dom.latestThumbImg.style.display = "block";
  dom.thumbPlaceholder.style.display = "none";
}

function openPreviewModal() {
  if (!state.currentViewingPhoto) {
    alert("尚未拍攝任何照片喔！請先按下快門拍照。");
    return;
  }
  state.activeTab = "stamped";
  updatePreviewModalContent();
  dom.previewModal.style.display = "flex";
}

function closePreviewModal() {
  dom.previewModal.style.display = "none";
}

function updatePreviewModalContent() {
  const t = state.currentViewingPhoto;
  if (!t) return;
  if (state.activeTab === "stamped") {
    dom.tabStamped.classList.add("active");
    dom.tabClean.classList.remove("active");
    dom.previewImg.src = t.stampedUrl;
  } else {
    dom.tabClean.classList.add("active");
    dom.tabStamped.classList.remove("active");
    dom.previewImg.src = t.cleanUrl;
  }
}

function saveCurrentViewingToLocal() {
  if (!state.currentViewingPhoto) return;
  saveTaskToLocal(state.currentViewingPhoto, true);
}

function saveTaskToLocal(task, showAlert) {
  const timeStr = task.timestamp.replace(/[: /]/g, "_");
  downloadBlob(task.stampedBlob, `打卡印章_${timeStr}.jpg`);
  setTimeout(() => downloadBlob(task.cleanBlob, `純淨原圖_${timeStr}.jpg`), 300);
  if (showAlert) {
    alert("已成功將【打卡印章圖】與【純淨原圖】存入手機相簿！");
  }
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 2 秒後釋放 URL
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// 7. 繪圖與輔助
function triggerShutterFlash() {
  dom.shutterFlash.classList.add("flash");
  setTimeout(() => dom.shutterFlash.classList.remove("flash"), 90);
}

function showQuickToast(msg) {
  dom.quickToast.textContent = msg;
  dom.quickToast.classList.add("show");
  setTimeout(() => dom.quickToast.classList.remove("show"), 1500);
}

function drawTravelStamp(ctx, width, height, title, addr, timeText, lat, lon) {
  const scale = Math.max(1, width / 1200);
  const baseFontSize = Math.round(18 * scale);
  const titleFontSize = Math.round(23 * scale);
  const padding = Math.round(18 * scale);
  const cardMargin = Math.round(20 * scale);
  const coordsText = (lat && lon)
    ? `座標：${lat.toFixed(6)}° N, ${lon.toFixed(6)}° E`
    : "衛星座標抓取中";

  ctx.save();
  const lineHeight = Math.round(26 * scale);
  const cardHeight = Math.round(135 * scale);
  const cardWidth = Math.min(width - (cardMargin * 2), Math.round(820 * scale));
  const cardX = cardMargin;
  const cardY = height - cardHeight - cardMargin;

  ctx.fillStyle = "rgba(16, 16, 16, 0.80)";
  ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
  ctx.shadowBlur = 10 * scale;
  drawRoundRect(ctx, cardX, cardY, cardWidth, cardHeight, 10 * scale);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = "#2ed573";
  ctx.font = `bold ${titleFontSize}px "Microsoft JhengHei", sans-serif`;
  ctx.fillText(`🚩 ${title}`, cardX + padding, cardY + padding + (titleFontSize * 0.8));

  ctx.fillStyle = "#ffffff";
  ctx.font = `500 ${baseFontSize}px "Microsoft JhengHei", sans-serif`;
  ctx.fillText(`📍 ${addr}`, cardX + padding, cardY + padding + titleFontSize + lineHeight);

  ctx.fillStyle = "#eccc68";
  ctx.font = `${Math.round(baseFontSize * 0.9)}px "Microsoft JhengHei", sans-serif`;
  ctx.fillText(`🕒 ${timeText}`, cardX + padding, cardY + padding + titleFontSize + (lineHeight * 2));

  ctx.fillStyle = "#ced6e0";
  ctx.font = `${Math.round(baseFontSize * 0.85)}px monospace`;
  ctx.fillText(`🌐 ${coordsText}`, cardX + padding, cardY + padding + titleFontSize + (lineHeight * 2.9));

  ctx.restore();
}

function drawRoundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

// 8. 事件綁定
let pinchStartDist = 0;
let pinchStartZoom = 1;

function initEventHandlers() {
  dom.btnCapture.addEventListener("click", capturePhotoInstantly);
  dom.btnSwitchCamera.addEventListener("click", switchCamera);
  dom.btnStartCameraManual.addEventListener("click", startCamera);
  dom.btnRefreshGps.addEventListener("click", initGeolocation);

  dom.thumbnailContainer.addEventListener("click", openPreviewModal);
  dom.btnClosePreview.addEventListener("click", closePreviewModal);
  dom.tabStamped.addEventListener("click", () => {
    state.activeTab = "stamped";
    updatePreviewModalContent();
  });
  dom.tabClean.addEventListener("click", () => {
    state.activeTab = "clean";
    updatePreviewModalContent();
  });
  dom.btnSaveLocal.addEventListener("click", saveCurrentViewingToLocal);
  dom.btnForceUpload.addEventListener("click", () => {
    if (state.currentViewingPhoto) {
      state.uploadQueue.push(state.currentViewingPhoto);
      triggerBackgroundUploader();
      alert("已將此張照片加入背景上傳佇列！");
      closePreviewModal();
    }
  });

  dom.btnSettings.addEventListener("click", () => dom.settingsModal.style.display = "flex");
  dom.btnCloseSettings.addEventListener("click", () => dom.settingsModal.style.display = "none");
  dom.btnSaveSettings.addEventListener("click", saveSettings);

  dom.zoomSlider.addEventListener("input", (e) => setZoom(e.target.value));
  dom.btnZoomIn.addEventListener("click", () => setZoom(state.currentZoom + state.cameraCaps.zoomStep));
  dom.btnZoomOut.addEventListener("click", () => setZoom(state.currentZoom - state.cameraCaps.zoomStep));

  const vp = document.getElementById("viewportArea");
  vp.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) {
      pinchStartDist = pinchDistance(e.touches);
      pinchStartZoom = state.currentZoom;
    }
  }, { passive: true });
  vp.addEventListener("touchmove", (e) => {
    if (e.touches.length === 2 && pinchStartDist > 0) {
      const d = pinchDistance(e.touches);
      const ratio = d / pinchStartDist;
      setZoom(pinchStartZoom * ratio);
    }
  }, { passive: true });
  vp.addEventListener("touchend", () => { pinchStartDist = 0; });
}

function pinchDistance(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function saveSettings() {
  state.gasUrl = dom.gasUrlInput.value.trim();
  state.autoUpload = dom.autoUploadCheck.checked;
  state.autoDownload = dom.autoDownloadCheck.checked;
  localStorage.setItem("travel_camera_gas_url", state.gasUrl);
  localStorage.setItem("travel_camera_auto_upload", state.autoUpload);
  localStorage.setItem("travel_camera_auto_download", state.autoDownload);
  dom.settingsModal.style.display = "none";
  alert("雲端同步設定已儲存！");
}

function formatFullDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${y}/${m}/${d} ${hh}:${mm}:${ss}`;
}
