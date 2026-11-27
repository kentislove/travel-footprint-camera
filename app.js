/**
 * 旅遊足跡相機核心控制腳本 (v6 最大畫素與縮放控制版)
 *
 * v6 新增重點（相較 v5）：
 * 1. 自動探測裝置鏡頭的「最大支援解析度」：先用一般請求開啟鏡頭，再透過
 *    track.getCapabilities() 讀出 width/height 上限，然後重新 applyConstraints
 *    把解析度拉到裝置極限（例如 4000×3000、4032×3024 等），讓照片畫質大幅提升。
 * 2. 縮放控制（Zoom）：
 *    - 若裝置支援原生 zoom（多數 Android Chrome、部分 iOS Safari 16+），直接
 *      透過 MediaStreamTrack applyConstraints 控制光學／原生數位變焦。
 *    - 不支援的裝置退回「Canvas 裁切數位縮放」，預覽用 CSS transform，拍攝時
 *      用 Canvas 中心裁切保留原始畫素，避免放大失真。
 * 3. 拍照不再強制縮小到 1920px，而是用「原生解析度」存檔，JPEG 品質提升到 0.95。
 * 4. 介面新增縮放滑桿與目前倍率顯示，雙指捏合手勢也會同步調整。
 */

// 1. 全域狀態管理
const state = {
  latitude: null,
  longitude: null,
  accuracy: null,
  address: "定位準備中...",
  currentTimestamp: "",
  activeTab: "stamped",
  mediaStream: null,
  currentTrack: null,
  currentFacingMode: "environment",
  gasUrl: localStorage.getItem("travel_camera_gas_url") || "https://script.google.com/macros/s/AKfycbxr3Zv5jRHXevBRVQdpJ1zINvYndnYtrsW6gfOg2-gGaf9pEXYWCLNkQECkirh-2X_OIw/exec",
  autoUpload: localStorage.getItem("travel_camera_auto_upload") !== "false",
  autoDownload: localStorage.getItem("travel_camera_auto_download") === "true",

  // 相機能力資訊（由 getCapabilities 取得）
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

  // 當前縮放倍率（原生 zoom 或數位倍率皆沿用此值）
  currentZoom: 1,

  // 背景上傳佇列系統
  uploadQueue: [],
  isUploading: false,

  // 目前檢視的照片快取
  currentViewingPhoto: null
};

// v6 不再硬性限制最大邊長；用 null 代表「原生解析度存檔」
const MAX_IMAGE_DIMENSION = null;
const JPEG_QUALITY = 0.95;

// 2. DOM 元素快取
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
  cleanCanvas: document.getElementById("cleanCanvas"),
  stampedCanvas: document.getElementById("stampedCanvas"),
  btnCapture: document.getElementById("btnCapture"),
  btnRefreshGps: document.getElementById("btnRefreshGps"),
  btnSettings: document.getElementById("btnSettings"),
  settingsModal: document.getElementById("settingsModal"),
  btnCloseSettings: document.getElementById("btnCloseSettings"),
  btnSaveSettings: document.getElementById("btnSaveSettings"),
  gasUrlInput: document.getElementById("gasUrlInput"),
  autoUploadCheck: document.getElementById("autoUploadCheck"),
  autoDownloadCheck: document.getElementById("autoDownloadCheck"),

  // 縮圖與預覽彈窗
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

  // v6 新增：解析度與縮放 UI
  resolutionBadge: document.getElementById("resolutionBadge"),
  zoomPanel: document.getElementById("zoomPanel"),
  zoomSlider: document.getElementById("zoomSlider"),
  zoomValue: document.getElementById("zoomValue"),
  btnZoomOut: document.getElementById("btnZoomOut"),
  btnZoomIn: document.getElementById("btnZoomIn")
};

// 3. 網頁啟動初始化
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

// 4. 相機啟動（兩段式：先開啟 → 再拉到最大解析度）
async function startCamera() {
  stopCamera();
  let stream = null;

  // 第一階段：先用相對寬鬆的條件開啟鏡頭，確保能拿到串流
  const facing = state.currentFacingMode;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: facing },
        width: { ideal: 4096 },
        height: { ideal: 4096 }
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

  // 第二階段：讀出裝置最大畫素，再 applyConstraints 推到極限
  await applyMaxResolution(state.currentTrack);

  // 第三階段：探測縮放能力並刷新 UI
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

async function applyMaxResolution(track) {
  if (!track || typeof track.getCapabilities !== "function") return;
  try {
    const caps = track.getCapabilities();
    const maxW = caps.width && caps.width.max ? caps.width.max : 0;
    const maxH = caps.height && caps.height.max ? caps.height.max : 0;
    state.cameraCaps.maxWidth = maxW;
    state.cameraCaps.maxHeight = maxH;

    if (maxW && maxH) {
      await track.applyConstraints({
        advanced: [{ width: maxW, height: maxH }]
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
    // 不支援原生 zoom，退回數位裁切變焦（1x–4x）
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
  dom.cameraVideo.style.transformOrigin = "center center";
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
  // 數位縮放只放大預覽；拍照時用 Canvas 裁切保留原始畫素
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

// 5. 定位與地址解析（沿用 v5）
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

// 6. 零延遲秒拍 + 原生解析度存檔
function capturePhotoInstantly() {
  const video = dom.cameraVideo;
  if (!video.videoWidth || !video.videoHeight) {
    dom.cameraPromptOverlay.style.display = "flex";
    return;
  }

  if (navigator.vibrate) navigator.vibrate(40);
  triggerShutterFlash();

  const timestampStr = formatFullDate(new Date());
  const currentAddress = state.address;
  const currentLat = state.latitude;
  const currentLon = state.longitude;
  const currentTripTitle = dom.tripTitleInput.value.trim() || "旅遊隨手拍";

  const origW = video.videoWidth;
  const origH = video.videoHeight;

  // 計算來源裁切（只在數位縮放時啟用，光學縮放時交給硬體處理）
  const useDigitalZoom = !state.cameraCaps.supportsNativeZoom && state.currentZoom > 1.01;
  let srcX = 0, srcY = 0, srcW = origW, srcH = origH;
  if (useDigitalZoom) {
    const z = state.currentZoom;
    srcW = Math.round(origW / z);
    srcH = Math.round(origH / z);
    srcX = Math.round((origW - srcW) / 2);
    srcY = Math.round((origH - srcH) / 2);
  }

  // v6：輸出目標尺寸 = 來源尺寸（原生畫素，不再縮水）
  const targetW = srcW;
  const targetH = srcH;

  // 版本 B：純淨原圖
  const cleanCanvas = dom.cleanCanvas;
  cleanCanvas.width = targetW;
  cleanCanvas.height = targetH;
  const cleanCtx = cleanCanvas.getContext("2d");
  cleanCtx.drawImage(video, srcX, srcY, srcW, srcH, 0, 0, targetW, targetH);
  const cleanDataUrl = cleanCanvas.toDataURL("image/jpeg", JPEG_QUALITY);

  // 版本 A：打卡印章圖
  const stampedCanvas = dom.stampedCanvas;
  stampedCanvas.width = targetW;
  stampedCanvas.height = targetH;
  const stampedCtx = stampedCanvas.getContext("2d");
  stampedCtx.drawImage(video, srcX, srcY, srcW, srcH, 0, 0, targetW, targetH);
  drawTravelStamp(stampedCtx, targetW, targetH, currentTripTitle, currentAddress, timestampStr, currentLat, currentLon);
  const stampedDataUrl = stampedCanvas.toDataURL("image/jpeg", JPEG_QUALITY);

  // 立刻釋放畫布記憶體
  cleanCanvas.width = 1;
  cleanCanvas.height = 1;
  stampedCanvas.width = 1;
  stampedCanvas.height = 1;

  const photoTask = {
    id: Date.now(),
    tripTitle: currentTripTitle,
    timestamp: timestampStr,
    address: currentAddress,
    latitude: currentLat,
    longitude: currentLon,
    width: targetW,
    height: targetH,
    cleanImageDataUrl: cleanDataUrl,
    stampedImageDataUrl: stampedDataUrl
  };

  updateLatestThumbnail(photoTask);
  const mp = ((targetW * targetH) / 1000000).toFixed(1);
  showQuickToast(`✓ 已拍下 ${targetW}×${targetH} (${mp}MP)`);

  if (state.autoDownload) {
    saveTaskToLocal(photoTask, false);
  }
  if (state.autoUpload && state.gasUrl) {
    state.uploadQueue.push(photoTask);
    triggerBackgroundUploader();
  }
}

// 7. 背景佇列上傳（沿用 v5）
async function triggerBackgroundUploader() {
  updateSyncBadge();
  if (state.isUploading) return;
  state.isUploading = true;

  while (state.uploadQueue.length > 0) {
    const currentTask = state.uploadQueue[0];
    updateSyncBadge();
    try {
      const payload = {
        tripTitle: currentTask.tripTitle,
        timestamp: currentTask.timestamp,
        address: currentTask.address,
        latitude: currentTask.latitude,
        longitude: currentTask.longitude,
        cleanImageBase64: currentTask.cleanImageDataUrl.split(",")[1],
        stampedImageBase64: currentTask.stampedImageDataUrl.split(",")[1]
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

// 8. 縮圖與預覽
function updateLatestThumbnail(photoTask) {
  state.currentViewingPhoto = photoTask;
  dom.latestThumbImg.src = photoTask.stampedImageDataUrl;
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
  const photo = state.currentViewingPhoto;
  if (!photo) return;
  if (state.activeTab === "stamped") {
    dom.tabStamped.classList.add("active");
    dom.tabClean.classList.remove("active");
    dom.previewImg.src = photo.stampedImageDataUrl;
  } else {
    dom.tabClean.classList.add("active");
    dom.tabStamped.classList.remove("active");
    dom.previewImg.src = photo.cleanImageDataUrl;
  }
}

function saveCurrentViewingToLocal() {
  if (!state.currentViewingPhoto) return;
  saveTaskToLocal(state.currentViewingPhoto, true);
}

function saveTaskToLocal(task, showAlert) {
  const timeStr = task.timestamp.replace(/[: /]/g, "_");
  downloadDataUrl(task.stampedImageDataUrl, `打卡印章_${timeStr}.jpg`);
  setTimeout(() => downloadDataUrl(task.cleanImageDataUrl, `純淨原圖_${timeStr}.jpg`), 300);
  if (showAlert) {
    alert("已成功將【打卡印章圖】與【純淨原圖】存入手機相簿！");
  }
}

function downloadDataUrl(url, name) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// 9. 繪圖工具
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

// 10. 事件綁定
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

  // v6 縮放控制
  dom.zoomSlider.addEventListener("input", (e) => setZoom(e.target.value));
  dom.btnZoomIn.addEventListener("click", () => setZoom(state.currentZoom + state.cameraCaps.zoomStep));
  dom.btnZoomOut.addEventListener("click", () => setZoom(state.currentZoom - state.cameraCaps.zoomStep));

  // 雙指捏合縮放
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
