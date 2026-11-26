/**
 * 旅遊足跡相機核心控制腳本 (v3 記憶體輕量化與即時觀景窗版)
 * 解決痛點：
 * 1. 徹底解決 Android 手機「記憶體不足 (Out of Memory)」問題：加入智慧降噪與尺寸約束 (最大 1920px)，杜絕記憶體崩潰。
 * 2. 徹底解決「黑畫面」問題：網頁一開啟自動啟動手機後置鏡頭取景，點擊大快門直接秒速截圖拍照！
 * 3. 支援前後鏡頭翻轉、繁體中文詳細地址解析與 Google 雲端自動同步。
 */

// 1. 全域狀態管理
const state = {
  latitude: null,
  longitude: null,
  accuracy: null,
  address: "定位準備中...",
  currentTimestamp: "",
  cleanImageDataUrl: null,   // 版本 B：純淨原圖
  stampedImageDataUrl: null, // 版本 A：打卡印章圖
  activeTab: "stamped",
  mediaStream: null,
  currentFacingMode: "environment", // 預設使用後置鏡頭
  gasUrl: localStorage.getItem("travel_camera_gas_url") || "https://script.google.com/macros/s/AKfycbxr3Zv5jRHXevBRVQdpJ1zINvYndnYtrsW6gfOg2-gGaf9pEXYWCLNkQECkirh-2X_OIw/exec",
  autoUpload: localStorage.getItem("travel_camera_auto_upload") !== "false",
  isCapturing: false
};

// 記憶體保護常數：將照片最大長寬限制在 1920 像素，避免手機解碼 5000 萬畫素時瞬間爆記憶體
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
  cleanCanvas: document.getElementById("cleanCanvas"),
  stampedCanvas: document.getElementById("stampedCanvas"),
  previewContainer: document.getElementById("previewContainer"),
  previewImg: document.getElementById("previewImg"),
  tabStamped: document.getElementById("tabStamped"),
  tabClean: document.getElementById("tabClean"),
  btnRetake: document.getElementById("btnRetake"),
  btnSaveLocal: document.getElementById("btnSaveLocal"),
  btnUploadCloud: document.getElementById("btnUploadCloud"),
  btnCapture: document.getElementById("btnCapture"),
  nativeCameraInput: document.getElementById("nativeCameraInput"),
  btnRefreshGps: document.getElementById("btnRefreshGps"),
  btnSettings: document.getElementById("btnSettings"),
  settingsModal: document.getElementById("settingsModal"),
  btnCloseSettings: document.getElementById("btnCloseSettings"),
  btnSaveSettings: document.getElementById("btnSaveSettings"),
  gasUrlInput: document.getElementById("gasUrlInput"),
  autoUploadCheck: document.getElementById("autoUploadCheck"),
  loadingOverlay: document.getElementById("loadingOverlay"),
  loadingText: document.getElementById("loadingText")
};

// 3. 網頁啟動初始化
window.addEventListener("DOMContentLoaded", () => {
  initSettings();
  initGeolocation();
  initEventHandlers();
  
  // 自動嘗試開啟相機即時畫面
  startCamera();
});

// 4. 設定初始化
function initSettings() {
  dom.gasUrlInput.value = state.gasUrl;
  dom.autoUploadCheck.checked = state.autoUpload;
}

// 5. 相機啟動與觀景窗管理
async function startCamera() {
  // 若原本已有鏡頭串流，先徹底關閉舊串流釋放記憶體
  stopCamera();

  dom.cameraPromptOverlay.style.display = "none";

  try {
    const constraints = {
      video: {
        facingMode: { ideal: state.currentFacingMode },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    state.mediaStream = stream;
    dom.cameraVideo.srcObject = stream;

    // 確保視訊順利播放
    await dom.cameraVideo.play();
  } catch (error) {
    console.error("相機啟動異常:", error);
    // 若自動播放受瀏覽器權限限制，顯示友善提示卡片供手動點擊允許
    dom.cameraPromptOverlay.style.display = "flex";
  }
}

function stopCamera() {
  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach(track => track.stop());
    state.mediaStream = null;
  }
  dom.cameraVideo.srcObject = null;
}

// 切換前後鏡頭
function switchCamera() {
  state.currentFacingMode = (state.currentFacingMode === "environment") ? "user" : "environment";
  startCamera();
}

// 6. 衛星定位與繁體中文地址解析
function initGeolocation() {
  if (!navigator.geolocation) {
    updateGpsUI(false, "裝置不支援定位功能");
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

// 7. 快門拍照核心（直接從即時觀景窗截圖，杜絕跳出與記憶體不足）
async function capturePhotoFromVideo() {
  if (state.isCapturing) return;
  state.isCapturing = true;

  // 1. 觸發觸感震動與快門閃光
  if (navigator.vibrate) navigator.vibrate(50);
  triggerShutterFlash();

  // 2. 檢查視訊是否就緒
  const video = dom.cameraVideo;
  if (!video.videoWidth || !video.videoHeight) {
    alert("相機畫面尚未載入完成，請稍候片刻再按快門！");
    state.isCapturing = false;
    return;
  }

  showLoading("正在處理照片與印章資訊...");

  // 延遲 50ms 讓畫面更新閃光動畫
  setTimeout(() => {
    // 3. 計算約束後的尺寸（防止超大解析度壓垮手機記憶體）
    const origW = video.videoWidth;
    const origH = video.videoHeight;
    const { targetW, targetH } = getConstrainedDimensions(origW, origH, MAX_IMAGE_DIMENSION);

    // 4. 產出【版本 B：純淨原圖】
    const cleanCanvas = dom.cleanCanvas;
    cleanCanvas.width = targetW;
    cleanCanvas.height = targetH;
    const cleanCtx = cleanCanvas.getContext("2d");
    cleanCtx.drawImage(video, 0, 0, targetW, targetH);
    state.cleanImageDataUrl = cleanCanvas.toDataURL("image/jpeg", 0.85);

    // 5. 產出【版本 A：打卡印章圖】
    const stampedCanvas = dom.stampedCanvas;
    stampedCanvas.width = targetW;
    stampedCanvas.height = targetH;
    const stampedCtx = stampedCanvas.getContext("2d");
    stampedCtx.drawImage(video, 0, 0, targetW, targetH);

    state.currentTimestamp = formatFullDate(new Date());
    drawTravelStamp(stampedCtx, targetW, targetH);
    state.stampedImageDataUrl = stampedCanvas.toDataURL("image/jpeg", 0.85);

    // 6. 釋放畫布暫存以保護手機記憶體
    cleanCanvas.width = 1;
    cleanCanvas.height = 1;
    stampedCanvas.width = 1;
    stampedCanvas.height = 1;

    // 7. 顯示預覽
    showPreview();
    hideLoading();
    state.isCapturing = false;

    // 8. 自動連動 Google 雲端硬碟
    if (state.autoUpload && state.gasUrl) {
      uploadImagesToGoogleDrive(true);
    }
  }, 60);
}

// 尺寸約束計算工具：將任意巨大相片等比例縮小在安全範圍內（防爆記憶體）
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

// 快門閃爍白光動畫
function triggerShutterFlash() {
  dom.shutterFlash.classList.add("flash");
  setTimeout(() => dom.shutterFlash.classList.remove("flash"), 120);
}

// 繪製打卡印章卡
function drawTravelStamp(ctx, width, height) {
  const scale = Math.max(1, width / 1200);
  const baseFontSize = Math.round(18 * scale);
  const titleFontSize = Math.round(23 * scale);
  const padding = Math.round(18 * scale);
  const cardMargin = Math.round(20 * scale);

  const tripTitle = dom.tripTitleInput.value.trim() || "旅遊隨手拍";
  const addressText = state.address || "未取得地址";
  const timeText = state.currentTimestamp;
  const coordsText = (state.latitude && state.longitude)
    ? `座標：${state.latitude.toFixed(6)}° N, ${state.longitude.toFixed(6)}° E (誤差±${Math.round(state.accuracy || 0)}m)`
    : "衛星座標抓取中";

  ctx.save();
  const lineHeight = Math.round(26 * scale);
  const cardHeight = Math.round(135 * scale);
  const cardWidth = Math.min(width - (cardMargin * 2), Math.round(820 * scale));
  const cardX = cardMargin;
  const cardY = height - cardHeight - cardMargin;

  // 繪製半透明深灰圓角印章底卡
  ctx.fillStyle = "rgba(18, 18, 18, 0.78)";
  ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
  ctx.shadowBlur = 10 * scale;
  drawRoundRect(ctx, cardX, cardY, cardWidth, cardHeight, 10 * scale);
  ctx.fill();

  ctx.shadowBlur = 0;

  // 標題 (亮綠色)
  ctx.fillStyle = "#2ed573";
  ctx.font = `bold ${titleFontSize}px "Microsoft JhengHei", sans-serif`;
  ctx.fillText(`🚩 ${tripTitle}`, cardX + padding, cardY + padding + (titleFontSize * 0.8));

  // 地址 (純白)
  ctx.fillStyle = "#ffffff";
  ctx.font = `500 ${baseFontSize}px "Microsoft JhengHei", sans-serif`;
  ctx.fillText(`📍 ${addressText}`, cardX + padding, cardY + padding + titleFontSize + lineHeight);

  // 時間 (暖黃)
  ctx.fillStyle = "#eccc68";
  ctx.font = `${Math.round(baseFontSize * 0.9)}px "Microsoft JhengHei", sans-serif`;
  ctx.fillText(`🕒 ${timeText}`, cardX + padding, cardY + padding + titleFontSize + (lineHeight * 2));

  // 經緯度 (灰白)
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

// 8. 預覽與操作控制
function showPreview() {
  dom.previewContainer.style.display = "flex";
  switchPreviewTab("stamped");
}

function switchPreviewTab(tabType) {
  state.activeTab = tabType;
  if (tabType === "stamped") {
    dom.tabStamped.classList.add("active");
    dom.tabClean.classList.remove("active");
    dom.previewImg.src = state.stampedImageDataUrl;
  } else {
    dom.tabClean.classList.add("active");
    dom.tabStamped.classList.remove("active");
    dom.previewImg.src = state.cleanImageDataUrl;
  }
}

function resetPreview() {
  dom.previewContainer.style.display = "none";
  state.cleanImageDataUrl = null;
  state.stampedImageDataUrl = null;
}

// 9. 本地存檔支援
function saveImagesToLocal() {
  if (!state.cleanImageDataUrl || !state.stampedImageDataUrl) return;
  const timeStr = state.currentTimestamp.replace(/[: /]/g, "_");
  downloadDataUrl(state.stampedImageDataUrl, `旅遊打卡印章_${timeStr}.jpg`);
  setTimeout(() => downloadDataUrl(state.cleanImageDataUrl, `旅遊純淨原圖_${timeStr}.jpg`), 350);
  alert("已成功將【版本 A：打卡印章圖】與【版本 B：純淨原圖】儲存至手機相簿！");
}

function downloadDataUrl(url, name) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// 10. 雲端同步
async function uploadImagesToGoogleDrive(isSilent) {
  if (!state.gasUrl) {
    if (!isSilent) {
      alert("尚未設定 Google 雲端接收小幫手網址！");
      dom.settingsModal.style.display = "flex";
    }
    return;
  }

  showLoading(isSilent ? "正在自動同步至 Google 雲端硬碟..." : "正在上傳雙版本照片...");

  try {
    const payload = {
      tripTitle: dom.tripTitleInput.value.trim() || "旅遊生活紀錄",
      timestamp: state.currentTimestamp,
      address: state.address,
      latitude: state.latitude,
      longitude: state.longitude,
      cleanImageBase64: state.cleanImageDataUrl.split(",")[1],
      stampedImageBase64: state.stampedImageDataUrl.split(",")[1]
    };

    const res = await fetch(state.gasUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });

    const result = await res.json();
    hideLoading();

    if (result && result.status === "success") {
      if (!isSilent) {
        alert(`🎉 恭喜小學生！雙版本照片已成功同步至 Google 雲端硬碟！\n雲端資料夾：${result.folderName}`);
      }
    } else {
      throw new Error(result.message || "雲端未回傳成功訊息");
    }
  } catch (err) {
    hideLoading();
    console.error(err);
    if (!isSilent) {
      alert("同步至雲端時連線有短暫延遲，請確認網路正常。");
    }
  }
}

// 11. 備用：相簿檔案選取處理 (同樣實施記憶體保護約束)
function handleNativeFile(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  showLoading("正在載入相片並進行輕量化處理...");
  const reader = new FileReader();
  reader.onload = (event) => {
    const img = new Image();
    img.onload = () => {
      const { targetW, targetH } = getConstrainedDimensions(img.width, img.height, MAX_IMAGE_DIMENSION);

      const cleanCanvas = dom.cleanCanvas;
      cleanCanvas.width = targetW;
      cleanCanvas.height = targetH;
      const cleanCtx = cleanCanvas.getContext("2d");
      cleanCtx.drawImage(img, 0, 0, targetW, targetH);
      state.cleanImageDataUrl = cleanCanvas.toDataURL("image/jpeg", 0.85);

      const stampedCanvas = dom.stampedCanvas;
      stampedCanvas.width = targetW;
      stampedCanvas.height = targetH;
      const stampedCtx = stampedCanvas.getContext("2d");
      stampedCtx.drawImage(img, 0, 0, targetW, targetH);

      state.currentTimestamp = formatFullDate(new Date());
      drawTravelStamp(stampedCtx, targetW, targetH);
      state.stampedImageDataUrl = stampedCanvas.toDataURL("image/jpeg", 0.85);

      cleanCanvas.width = 1;
      cleanCanvas.height = 1;
      stampedCanvas.width = 1;
      stampedCanvas.height = 1;

      showPreview();
      hideLoading();

      if (state.autoUpload && state.gasUrl) {
        uploadImagesToGoogleDrive(true);
      }
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
  dom.nativeCameraInput.value = "";
}

// 12. 事件綁定
function initEventHandlers() {
  // 快門按鈕
  dom.btnCapture.addEventListener("click", capturePhotoFromVideo);

  // 翻轉鏡頭按鈕
  dom.btnSwitchCamera.addEventListener("click", switchCamera);

  // 友善授權卡片手動開啟
  dom.btnStartCameraManual.addEventListener("click", startCamera);

  // 重新抓取定位按鈕
  dom.btnRefreshGps.addEventListener("click", initGeolocation);

  // 原生相片選取 (備用)
  dom.nativeCameraInput.addEventListener("change", handleNativeFile);

  // 預覽切換與控制
  dom.tabStamped.addEventListener("click", () => switchPreviewTab("stamped"));
  dom.tabClean.addEventListener("click", () => switchPreviewTab("clean"));
  dom.btnRetake.addEventListener("click", resetPreview);
  dom.btnSaveLocal.addEventListener("click", saveImagesToLocal);
  dom.btnUploadCloud.addEventListener("click", () => uploadImagesToGoogleDrive(false));

  // 設定視窗開關
  dom.btnSettings.addEventListener("click", () => dom.settingsModal.style.display = "flex");
  dom.btnCloseSettings.addEventListener("click", () => dom.settingsModal.style.display = "none");
  dom.btnSaveSettings.addEventListener("click", saveSettings);
}

function saveSettings() {
  state.gasUrl = dom.gasUrlInput.value.trim();
  state.autoUpload = dom.autoUploadCheck.checked;
  localStorage.setItem("travel_camera_gas_url", state.gasUrl);
  localStorage.setItem("travel_camera_auto_upload", state.autoUpload);
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

function showLoading(msg) {
  dom.loadingText.textContent = msg;
  dom.loadingOverlay.style.display = "flex";
}

function hideLoading() {
  dom.loadingOverlay.style.display = "none";
}
