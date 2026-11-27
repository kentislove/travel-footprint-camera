/**
 * 旅遊足跡相機核心控制腳本 (v8 iOS 相簿存檔修復版)
 *
 * v8 相較 v7 的三大修復（專治 iPhone）：
 * 1. iOS 存檔改走 Web Share API：改用 navigator.share({ files: [...] })
 *    呼叫系統原生分享表，使用者點「儲存影像」即可存入照片 App。
 *    不再用 <a download> 連點兩下（那是 iPhone 鏡頭中斷的真兇）。
 * 2. 關閉 iOS 的「自動下載」：iOS 根本不支援背景存相簿，自動下載只會
 *    讓使用者每拍一張就被下載對話框打斷鏡頭。v8 在 iOS 直接忽略
 *    autoDownload，改在設定頁顯示提示。
 * 3. 上傳加速：縮小上傳用的 JPEG（上傳版本 1920px/0.82），和存檔版本
 *    （原生最大/0.90）解耦；fetch 加上 timeout 與 keepalive，避免
 *    GAS 冷啟動時卡死整個佇列。
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

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
              (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const IOS_SAFE_MAX_DIM = 2560;
const ANDROID_SAFE_MAX_DIM = 4096;
const JPEG_QUALITY = isIOS ? 0.90 : 0.92;

// v8：上傳用的縮小規格（兼顧畫質與速度）
const UPLOAD_MAX_DIM = 1920;
const UPLOAD_JPEG_QUALITY = 0.82;

// v8：Web Share API 支援偵測
const canShareFiles = (typeof navigator.canShare === "function") &&
                      (typeof navigator.share === "function");

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

  // v8：iOS 直接鎖住自動下載選項並說明原因
  if (isIOS) {
    dom.autoDownloadCheck.checked = false;
    dom.autoDownloadCheck.disabled = true;
    state.autoDownload = false;
    const label = dom.autoDownloadCheck.closest(".switch-row");
    if (label) {
      const tip = document.createElement("div");
      tip.style.cssText = "font-size:0.8rem;color:#eccc68;margin-top:4px;line-height:1.4;";
      tip.textContent = "📱 iPhone 無法背景自動存相簿（會中斷鏡頭）。請拍完後點縮圖→💾，從系統分享表選「儲存影像」。";
      label.appendChild(tip);
    }
  }
}

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

function capturePhotoInstantly() {
  const video = dom.cameraVideo;
  if (!video.videoWidth || !video.videoHeight) {
    dom.cameraPromptOverlay.style.display = "flex";
    return;
  }

  if (navigator.vibrate) navigator.vibrate(40);
  triggerShutterFlash();

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

  const useDigitalZoom = !state.cameraCaps.supportsNativeZoom && state.currentZoom > 1.01;
  let srcX = 0, srcY = 0, srcW = origW, srcH = origH;
  if (useDigitalZoom) {
    const z = state.currentZoom;
    srcW = Math.round(origW / z);
    srcH = Math.round(origH / z);
    srcX = Math.round((origW - srcW) / 2);
    srcY = Math.round((origH - srcH) / 2);
  }

  const cleanCanvas = document.createElement("canvas");
  const stampedCanvas = document.createElement("canvas");
  cleanCanvas.width = srcW;
  cleanCanvas.height = srcH;
  stampedCanvas.width = srcW;
  stampedCanvas.height = srcH;

  cleanCanvas.getContext("2d").drawImage(video, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);
  const sCtx = stampedCanvas.getContext("2d");
  sCtx.drawImage(video, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);
  drawTravelStamp(sCtx, srcW, srcH, snapshot.tripTitle, snapshot.address, snapshot.timestamp, snapshot.latitude, snapshot.longitude);

  const mp = ((srcW * srcH) / 1000000).toFixed(1);
  showQuickToast(`✓ 已拍下 ${srcW}×${srcH} (${mp}MP)`);

  // v8：同時產出 (1) 原尺寸高畫質 blob 給本地存檔 (2) 縮小版 blob 給上傳
  Promise.all([
    canvasToBlob(cleanCanvas, "image/jpeg", JPEG_QUALITY),
    canvasToBlob(stampedCanvas, "image/jpeg", JPEG_QUALITY),
    canvasToUploadBlob(cleanCanvas),
    canvasToUploadBlob(stampedCanvas)
  ]).then(([cleanBlob, stampedBlob, cleanUploadBlob, stampedUploadBlob]) => {
    const task = Object.assign({}, snapshot, {
      width: srcW,
      height: srcH,
      cleanBlob,
      stampedBlob,
      cleanUploadBlob,
      stampedUploadBlob,
      cleanUrl: URL.createObjectURL(cleanBlob),
      stampedUrl: URL.createObjectURL(stampedBlob)
    });

    updateLatestThumbnail(task);

    // v8：iOS 強制忽略自動下載
    if (state.autoDownload && !isIOS) saveTaskToLocal(task, false);
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
      try {
        const dataUrl = canvas.toDataURL(type, quality);
        fetch(dataUrl).then(r => r.blob()).then(resolve).catch(reject);
      } catch (e) { reject(e); }
    }
  });
}

// v8：縮小後再編碼 blob 給上傳用，加速 GAS 傳輸
function canvasToUploadBlob(sourceCanvas) {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  if (w <= UPLOAD_MAX_DIM && h <= UPLOAD_MAX_DIM) {
    return canvasToBlob(sourceCanvas, "image/jpeg", UPLOAD_JPEG_QUALITY);
  }
  const ratio = Math.min(UPLOAD_MAX_DIM / w, UPLOAD_MAX_DIM / h);
  const dw = Math.round(w * ratio);
  const dh = Math.round(h * ratio);
  const small = document.createElement("canvas");
  small.width = dw;
  small.height = dh;
  small.getContext("2d").drawImage(sourceCanvas, 0, 0, dw, dh);
  return canvasToBlob(small, "image/jpeg", UPLOAD_JPEG_QUALITY);
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

// v8：fetch 加上 timeout 避免 GAS 冷啟動卡死
function fetchWithTimeout(url, options, timeoutMs) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error("上傳逾時"));
    }, timeoutMs);
    fetch(url, Object.assign({}, options, { signal: controller.signal }))
      .then((res) => { clearTimeout(timer); resolve(res); })
      .catch((err) => { clearTimeout(timer); reject(err); });
  });
}

async function triggerBackgroundUploader() {
  updateSyncBadge();
  if (state.isUploading) return;
  state.isUploading = true;

  while (state.uploadQueue.length > 0) {
    const task = state.uploadQueue[0];
    updateSyncBadge();
    try {
      // v8：優先用縮小版 blob 加速上傳
      const uploadClean = task.cleanUploadBlob || task.cleanBlob;
      const uploadStamped = task.stampedUploadBlob || task.stampedBlob;
      const [cleanB64, stampedB64] = await Promise.all([
        blobToBase64(uploadClean),
        blobToBase64(uploadStamped)
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
      const res = await fetchWithTimeout(state.gasUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
      }, 45000);
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

// v8：iOS 走 Web Share API（一次呼叫兩個 File），Android/桌機走原本的下載連結
async function saveTaskToLocal(task, showAlert) {
  const timeStr = task.timestamp.replace(/[: /]/g, "_");
  const stampedName = `打卡印章_${timeStr}.jpg`;
  const cleanName = `純淨原圖_${timeStr}.jpg`;

  if (isIOS && canShareFiles) {
    try {
      const stampedFile = new File([task.stampedBlob], stampedName, { type: "image/jpeg" });
      const cleanFile = new File([task.cleanBlob], cleanName, { type: "image/jpeg" });
      const filesToShare = [stampedFile, cleanFile];

      if (navigator.canShare({ files: filesToShare })) {
        await navigator.share({
          files: filesToShare,
          title: task.tripTitle,
          text: `${task.address} ${task.timestamp}`
        });
        if (showAlert) showQuickToast("✓ 分享表已開啟，請點「儲存影像」");
        return;
      }

      // 分享表不支援多檔時，只分享打卡圖（多數情境夠用）
      if (navigator.canShare({ files: [stampedFile] })) {
        await navigator.share({ files: [stampedFile], title: task.tripTitle });
        if (showAlert) showQuickToast("✓ 已分享打卡印章圖，純淨原圖請從雲端下載");
        return;
      }
    } catch (err) {
      // 使用者按取消或 share 失敗 → 不要再回退到下載連結，避免中斷鏡頭
      if (err && err.name === "AbortError") {
        showQuickToast("已取消存檔");
        return;
      }
      console.warn("Web Share 失敗，回退到下載連結：", err);
    }
    // iOS 真的沒救時，提示使用者從預覽視窗長按儲存
    alert("這台 iPhone 不支援直接存到相簿。請在預覽視窗長按圖片 → 選「儲存影像」。");
    return;
  }

  // Android / 桌機：原本的下載路徑
  downloadBlob(task.stampedBlob, stampedName);
  setTimeout(() => downloadBlob(task.cleanBlob, cleanName), 300);
  if (showAlert) {
    alert("已將【打卡印章圖】與【純淨原圖】送入下載。");
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
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

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
  state.autoDownload = isIOS ? false : dom.autoDownloadCheck.checked;
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
