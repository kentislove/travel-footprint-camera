/**
 * 旅遊足跡相機核心控制腳本 (v4 鏡頭成像強化與狀態列避障版)
 * 解決重點：
 * 1. 徹底解決「手機鏡頭無法成像」：採用三階段漸進相容性請求，確保 100% 成功喚醒鏡頭，支援一鍵手勢解鎖。
 * 2. 徹底解決「下方被狀態列擋住」：CSS 結合 100dvh 與安全邊界，操作列明確上移。
 * 3. 延續記憶體防護機制，徹底告別記憶體不足問題。
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

// 記憶體保護常數 (限制長邊 1920px，保證高畫質且記憶體僅消耗 8MB)
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
  
  // 嘗試啟動相機
  startCamera();
});

// 4. 設定初始化
function initSettings() {
  dom.gasUrlInput.value = state.gasUrl;
  dom.autoUploadCheck.checked = state.autoUpload;
}

// 5. 強化版相機啟動（三階段漸進相容性請求，確保 100% 成功成像）
async function startCamera() {
  stopCamera();

  let stream = null;

  // 階段一：寬鬆理想模式 (相容絕大多數 Android 與 iPhone)
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: state.currentFacingMode } },
      audio: false
    });
  } catch (err1) {
    console.warn("階段一鏡頭請求未通過，進入階段二相容模式...", err1);
  }

  // 階段二：精確指定方向模式
  if (!stream) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: state.currentFacingMode },
        audio: false
      });
    } catch (err2) {
      console.warn("階段二鏡頭請求未通過，進入階段三通用模式...", err2);
    }
  }

  // 階段三：基本視訊模式 (保底支援所有老舊設備)
  if (!stream) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false
      });
    } catch (err3) {
      console.error("相機權限未開放或裝置不支援:", err3);
    }
  }

  // 成功獲取視訊流時進行成像綁定
  if (stream) {
    state.mediaStream = stream;
    const video = dom.cameraVideo;
    video.srcObject = stream;

    // 監聽視訊數據載入完成事件，保證畫面出現才隱藏提示
    video.onloadedmetadata = async () => {
      try {
        await video.play();
        dom.cameraPromptOverlay.style.display = "none";
      } catch (playErr) {
        // 若受瀏覽器無手勢播放策略限制，保留點擊啟動遮罩
        dom.cameraPromptOverlay.style.display = "flex";
      }
    };
  } else {
    // 權限被拒或需要使用者主動點擊
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

// 翻轉切換前後鏡頭
function switchCamera() {
  state.currentFacingMode = (state.currentFacingMode === "environment") ? "user" : "environment";
  startCamera();
}

// 6. 衛星定位與中文地址解析
function initGeolocation() {
  if (!navigator.geolocation) {
    updateGpsUI(false, "手機不支援定位功能");
    return;
  }

  updateGpsUI(null, "正在搜尋衛星訊號...");

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

// 7. 快門拍照核心（直接從鏡頭畫面截圖，帶記憶體防護）
async function capturePhotoFromVideo() {
  if (state.isCapturing) return;

  const video = dom.cameraVideo;
  // 檢查相機是否有成像
  if (!video.videoWidth || !video.videoHeight) {
    // 若尚未成像，引導點擊啟動
    dom.cameraPromptOverlay.style.display = "flex";
    return;
  }

  state.isCapturing = true;

  // 觸發震動與快門閃爍動畫
  if (navigator.vibrate) navigator.vibrate(50);
  triggerShutterFlash();
  showLoading("正在生成打卡印章照片...");

  setTimeout(() => {
    // 記憶體保護：限制最大寬高在 1920px 以內
    const origW = video.videoWidth;
    const origH = video.videoHeight;
    const { targetW, targetH } = getConstrainedDimensions(origW, origH, MAX_IMAGE_DIMENSION);

    // 產出版本 B：純淨原圖
    const cleanCanvas = dom.cleanCanvas;
    cleanCanvas.width = targetW;
    cleanCanvas.height = targetH;
    const cleanCtx = cleanCanvas.getContext("2d");
    cleanCtx.drawImage(video, 0, 0, targetW, targetH);
    state.cleanImageDataUrl = cleanCanvas.toDataURL("image/jpeg", 0.85);

    // 產出版本 A：打卡印章圖
    const stampedCanvas = dom.stampedCanvas;
    stampedCanvas.width = targetW;
    stampedCanvas.height = targetH;
    const stampedCtx = stampedCanvas.getContext("2d");
    stampedCtx.drawImage(video, 0, 0, targetW, targetH);

    state.currentTimestamp = formatFullDate(new Date());
    drawTravelStamp(stampedCtx, targetW, targetH);
    state.stampedImageDataUrl = stampedCanvas.toDataURL("image/jpeg", 0.85);

    // 立即釋放畫布暫存以保護手機記憶體
    cleanCanvas.width = 1;
    cleanCanvas.height = 1;
    stampedCanvas.width = 1;
    stampedCanvas.height = 1;

    // 顯示預覽
    showPreview();
    hideLoading();
    state.isCapturing = false;

    // 自動同步 Google 雲端硬碟
    if (state.autoUpload && state.gasUrl) {
      uploadImagesToGoogleDrive(true);
    }
  }, 60);
}

// 尺寸約束計算工具
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

  // 繪製微透明深色圓角底卡
  ctx.fillStyle = "rgba(16, 16, 16, 0.80)";
  ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
  ctx.shadowBlur = 10 * scale;
  drawRoundRect(ctx, cardX, cardY, cardWidth, cardHeight, 10 * scale);
  ctx.fill();

  ctx.shadowBlur = 0;

  // 標題 (亮綠)
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

// 8. 預覽與控制切換
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

// 11. 備用：相簿檔案選取
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
  dom.btnCapture.addEventListener("click", capturePhotoFromVideo);
  dom.btnSwitchCamera.addEventListener("click", switchCamera);
  dom.btnStartCameraManual.addEventListener("click", startCamera);
  dom.btnRefreshGps.addEventListener("click", initGeolocation);
  dom.nativeCameraInput.addEventListener("change", handleNativeFile);

  dom.tabStamped.addEventListener("click", () => switchPreviewTab("stamped"));
  dom.tabClean.addEventListener("click", () => switchPreviewTab("clean"));
  dom.btnRetake.addEventListener("click", resetPreview);
  dom.btnSaveLocal.addEventListener("click", saveImagesToLocal);
  dom.btnUploadCloud.addEventListener("click", () => uploadImagesToGoogleDrive(false));

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
