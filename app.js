/**
 * 旅遊足跡相機核心控制腳本 (v5 背景無感秒拍與非阻塞上傳佇列版)
 * 解決重點：
 * 1. 拍照零延遲：快門一按立即完成，0.1秒秒拍，觀景窗完全不中斷，隨心所欲連拍！
 * 2. 背景佇列上傳：照片拍完自動排隊，在背景默默傳送到 Google 雲端硬碟，頂部微型徽章即時顯示進度。
 * 3. 左下角相片縮圖：最新拍攝照片即時預覽，點擊隨時檢視與存入手機相簿。
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
  currentFacingMode: "environment", // 預設使用後置鏡頭
  gasUrl: localStorage.getItem("travel_camera_gas_url") || "https://script.google.com/macros/s/AKfycbxr3Zv5jRHXevBRVQdpJ1zINvYndnYtrsW6gfOg2-gGaf9pEXYWCLNkQECkirh-2X_OIw/exec",
  autoUpload: localStorage.getItem("travel_camera_auto_upload") !== "false",
  autoDownload: localStorage.getItem("travel_camera_auto_download") === "true",
  
  // 背景上傳佇列系統
  uploadQueue: [],
  isUploading: false,

  // 目前檢視的照片快取
  currentViewingPhoto: null
};

// 記憶體保護安全上限 (1920px)
const MAX_IMAGE_DIMENSION = 1920;

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
  btnForceUpload: document.getElementById("btnForceUpload")
};

// 3. 網頁啟動初始化
window.addEventListener("DOMContentLoaded", () => {
  initSettings();
  initGeolocation();
  initEventHandlers();
  
  // 自動啟動鏡頭
  startCamera();
});

// 4. 設定初始化
function initSettings() {
  dom.gasUrlInput.value = state.gasUrl;
  dom.autoUploadCheck.checked = state.autoUpload;
  dom.autoDownloadCheck.checked = state.autoDownload;
}

// 5. 相機啟動與三階段相容請求
async function startCamera() {
  stopCamera();
  let stream = null;

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: state.currentFacingMode } },
      audio: false
    });
  } catch (err1) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: state.currentFacingMode },
        audio: false
      });
    } catch (err2) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } catch (err3) {
        console.error("相機存取被拒或不支援:", err3);
      }
    }
  }

  if (stream) {
    state.mediaStream = stream;
    const video = dom.cameraVideo;
    video.srcObject = stream;

    video.onloadedmetadata = async () => {
      try {
        await video.play();
        dom.cameraPromptOverlay.style.display = "none";
      } catch (e) {
        dom.cameraPromptOverlay.style.display = "flex";
      }
    };
  } else {
    dom.cameraPromptOverlay.style.display = "flex";
  }
}

function stopCamera() {
  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach(t => t.stop());
    state.mediaStream = null;
  }
  dom.cameraVideo.srcObject = null;
}

function switchCamera() {
  state.currentFacingMode = (state.currentFacingMode === "environment") ? "user" : "environment";
  startCamera();
}

// 6. 定位與地址解析
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

// 7. 零延遲秒拍核心（拍照完成立刻回到觀景窗，上傳交由背景佇列）
function capturePhotoInstantly() {
  const video = dom.cameraVideo;
  if (!video.videoWidth || !video.videoHeight) {
    dom.cameraPromptOverlay.style.display = "flex";
    return;
  }

  // 1. 觸發震動與快門閃爍動畫
  if (navigator.vibrate) navigator.vibrate(40);
  triggerShutterFlash();

  // 2. 抓取當下的時間與座標快照
  const timestampStr = formatFullDate(new Date());
  const currentAddress = state.address;
  const currentLat = state.latitude;
  const currentLon = state.longitude;
  const currentTripTitle = dom.tripTitleInput.value.trim() || "旅遊隨手拍";

  // 3. 尺寸約束與雙圖生成 (記憶體保護)
  const origW = video.videoWidth;
  const origH = video.videoHeight;
  const { targetW, targetH } = getConstrainedDimensions(origW, origH, MAX_IMAGE_DIMENSION);

  // 產出版本 B：純淨原圖
  const cleanCanvas = dom.cleanCanvas;
  cleanCanvas.width = targetW;
  cleanCanvas.height = targetH;
  const cleanCtx = cleanCanvas.getContext("2d");
  cleanCtx.drawImage(video, 0, 0, targetW, targetH);
  const cleanDataUrl = cleanCanvas.toDataURL("image/jpeg", 0.85);

  // 產出版本 A：打卡印章圖
  const stampedCanvas = dom.stampedCanvas;
  stampedCanvas.width = targetW;
  stampedCanvas.height = targetH;
  const stampedCtx = stampedCanvas.getContext("2d");
  stampedCtx.drawImage(video, 0, 0, targetW, targetH);
  drawTravelStamp(stampedCtx, targetW, targetH, currentTripTitle, currentAddress, timestampStr, currentLat, currentLon);
  const stampedDataUrl = stampedCanvas.toDataURL("image/jpeg", 0.85);

  // 立即重置畫布釋放暫存記憶體
  cleanCanvas.width = 1;
  cleanCanvas.height = 1;
  stampedCanvas.width = 1;
  stampedCanvas.height = 1;

  // 4. 打包照片任務物件
  const photoTask = {
    id: Date.now(),
    tripTitle: currentTripTitle,
    timestamp: timestampStr,
    address: currentAddress,
    latitude: currentLat,
    longitude: currentLon,
    cleanImageDataUrl: cleanDataUrl,
    stampedImageDataUrl: stampedDataUrl
  };

  // 5. 更新左下角縮圖並儲存最新快照
  updateLatestThumbnail(photoTask);

  // 6. 浮動微通知：已拍下
  showQuickToast("✓ 已拍下！背景同步中");

  // 7. 若開啟自動下載手機相簿
  if (state.autoDownload) {
    saveTaskToLocal(photoTask, false);
  }

  // 8. 推入背景上傳佇列（完全不阻擋前台拍照，你可以立刻按下一張！）
  if (state.autoUpload && state.gasUrl) {
    state.uploadQueue.push(photoTask);
    triggerBackgroundUploader();
  }
}

// 8. 背景佇列上傳引擎 (Background Upload Queue)
async function triggerBackgroundUploader() {
  updateSyncBadge();

  // 若已有上傳工序正在進行中，讓其自然依序消費佇列
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
        // 成功上傳，從佇列移出
        state.uploadQueue.shift();
      } else {
        throw new Error("伺服器未回傳成功");
      }
    } catch (err) {
      console.warn("背景上傳暫時延遲，3秒後自動重試...", err);
      // 遇網路問題稍作等待，再重試，不丟出錯誤中斷使用者
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 9. 左下角縮圖與預覽控制
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

// 10. 本地存檔
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

// 11. 輔助繪圖與計算工具
function getConstrainedDimensions(width, height, maxDimension) {
  if (width <= maxDimension && height <= maxDimension) {
    return { targetW: width, targetH: height };
  }
  const ratio = Math.min(maxDimension / width, maxDimension / height);
  return {
    targetW: Math.round(width * ratio),
    targetH: Math.round(height * ratio)
  };
}

function triggerShutterFlash() {
  dom.shutterFlash.classList.add("flash");
  setTimeout(() => dom.shutterFlash.classList.remove("flash"), 90);
}

function showQuickToast(msg) {
  dom.quickToast.textContent = msg;
  dom.quickToast.classList.add("show");
  setTimeout(() => dom.quickToast.classList.remove("show"), 1200);
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

  // 標題
  ctx.fillStyle = "#2ed573";
  ctx.font = `bold ${titleFontSize}px "Microsoft JhengHei", sans-serif`;
  ctx.fillText(`🚩 ${title}`, cardX + padding, cardY + padding + (titleFontSize * 0.8));

  // 地址
  ctx.fillStyle = "#ffffff";
  ctx.font = `500 ${baseFontSize}px "Microsoft JhengHei", sans-serif`;
  ctx.fillText(`📍 ${addr}`, cardX + padding, cardY + padding + titleFontSize + lineHeight);

  // 時間
  ctx.fillStyle = "#eccc68";
  ctx.font = `${Math.round(baseFontSize * 0.9)}px "Microsoft JhengHei", sans-serif`;
  ctx.fillText(`🕒 ${timeText}`, cardX + padding, cardY + padding + titleFontSize + (lineHeight * 2));

  // 經緯度
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

// 12. 事件綁定
function initEventHandlers() {
  // 快門秒拍按鈕
  dom.btnCapture.addEventListener("click", capturePhotoInstantly);

  // 切換前後鏡頭
  dom.btnSwitchCamera.addEventListener("click", switchCamera);

  // 啟動相機手勢按鈕
  dom.btnStartCameraManual.addEventListener("click", startCamera);

  // 重整定位按鈕
  dom.btnRefreshGps.addEventListener("click", initGeolocation);

  // 點擊左下角縮圖開啟照片檢視
  dom.thumbnailContainer.addEventListener("click", openPreviewModal);
  dom.btnClosePreview.addEventListener("click", closePreviewModal);

  // 預覽分頁切換
  dom.tabStamped.addEventListener("click", () => {
    state.activeTab = "stamped";
    updatePreviewModalContent();
  });
  dom.tabClean.addEventListener("click", () => {
    state.activeTab = "clean";
    updatePreviewModalContent();
  });

  // 存入手機按鈕
  dom.btnSaveLocal.addEventListener("click", saveCurrentViewingToLocal);

  // 手動立即同步
  dom.btnForceUpload.addEventListener("click", () => {
    if (state.currentViewingPhoto) {
      state.uploadQueue.push(state.currentViewingPhoto);
      triggerBackgroundUploader();
      alert("已將此張照片加入背景上傳佇列！");
      closePreviewModal();
    }
  });

  // 設定彈窗
  dom.btnSettings.addEventListener("click", () => dom.settingsModal.style.display = "flex");
  dom.btnCloseSettings.addEventListener("click", () => dom.settingsModal.style.display = "none");
  dom.btnSaveSettings.addEventListener("click", saveSettings);
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
