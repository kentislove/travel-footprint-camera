/**
 * 旅遊足跡相機核心控制腳本 (app.js)
 * 負責：GPS定位抓取、繁體中文地址解析、相機拍攝、雙版本照片(A+B)繪製與Google雲端硬碟同步
 */

// 全域狀態儲存區
const state = {
  latitude: null,
  longitude: null,
  altitude: null,
  accuracy: null,
  address: "尚未取得地址",
  currentTimestamp: "",
  cleanImageDataUrl: null,   // 版本 B：純淨原圖
  stampedImageDataUrl: null, // 版本 A：打卡印章圖
  activeTab: "stamped",      // 目前預覽的分頁
  mediaStream: null,
  isCameraActive: false,
  gasUrl: localStorage.getItem("travel_camera_gas_url") || "",
  autoUpload: localStorage.getItem("travel_camera_auto_upload") !== "false"
};

// DOM 元素快取
const dom = {
  gpsIndicator: document.getElementById("gpsIndicator"),
  gpsStatus: document.getElementById("gpsStatus"),
  addressDisplay: document.getElementById("addressDisplay"),
  tripTitleInput: document.getElementById("tripTitleInput"),
  cameraVideo: document.getElementById("cameraVideo"),
  cleanCanvas: document.getElementById("cleanCanvas"),
  stampedCanvas: document.getElementById("stampedCanvas"),
  previewContainer: document.getElementById("previewContainer"),
  previewImg: document.getElementById("previewImg"),
  tabStamped: document.getElementById("tabStamped"),
  tabClean: document.getElementById("tabClean"),
  btnRetake: document.getElementById("btnRetake"),
  btnSaveLocal: document.getElementById("btnSaveLocal"),
  btnUploadCloud: document.getElementById("btnUploadCloud"),
  nativeCameraInput: document.getElementById("nativeCameraInput"),
  btnWebcamShutter: document.getElementById("btnWebcamShutter"),
  cameraControls: document.getElementById("cameraControls"),
  btnSettings: document.getElementById("btnSettings"),
  settingsModal: document.getElementById("settingsModal"),
  btnCloseSettings: document.getElementById("btnCloseSettings"),
  btnSaveSettings: document.getElementById("btnSaveSettings"),
  gasUrlInput: document.getElementById("gasUrlInput"),
  autoUploadCheck: document.getElementById("autoUploadCheck"),
  loadingOverlay: document.getElementById("loadingOverlay"),
  loadingText: document.getElementById("loadingText")
};

// 1. 初始化程序
window.addEventListener("DOMContentLoaded", () => {
  initSettings();
  initGeolocation();
  initEventHandlers();
});

// 2. 設定相關初始化
function initSettings() {
  if (state.gasUrl) {
    dom.gasUrlInput.value = state.gasUrl;
  }
  dom.autoUploadCheck.checked = state.autoUpload;
}

// 3. 地理定位與中文地址解析模組
function initGeolocation() {
  if (!navigator.geolocation) {
    updateGpsUI(false, "此裝置或瀏覽器不支援地理定位");
    return;
  }

  updateGpsUI(null, "正在搜尋衛星訊號...");

  // 即時監聽位置變更 (適合旅遊邊走邊拍)
  navigator.geolocation.watchPosition(
    async (position) => {
      const coords = position.coords;
      state.latitude = coords.latitude;
      state.longitude = coords.longitude;
      state.altitude = coords.altitude;
      state.accuracy = coords.accuracy;

      updateGpsUI(true, `定位成功 (精確度: 約 ${Math.round(coords.accuracy)} 公尺)`);

      // 開始逆向解析繁體中文地址
      await resolveChineseAddress(coords.latitude, coords.longitude);
    },
    (error) => {
      let errorMsg = "無法取得定位";
      if (error.code === 1) errorMsg = "請允許瀏覽器存取位置權限";
      else if (error.code === 2) errorMsg = "目前收不到 GPS 衛星訊號";
      else if (error.code === 3) errorMsg = "定位逾時，請重新整理重試";
      updateGpsUI(false, errorMsg);
    },
    {
      enableHighAccuracy: true, // 啟用高精確度模式
      timeout: 15000,
      maximumAge: 10000
    }
  );
}

function updateGpsUI(isReady, message) {
  dom.gpsStatus.textContent = message;
  dom.gpsIndicator.className = "status-indicator";
  if (isReady === true) {
    dom.gpsIndicator.classList.add("ready");
  } else if (isReady === false) {
    dom.gpsIndicator.classList.add("error");
  }
}

// 呼叫開放街圖逆地理編碼服務取得台灣繁體中文門牌
async function resolveChineseAddress(lat, lon) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&accept-language=zh-TW`;
    const response = await fetch(url, { headers: { "Accept-Language": "zh-TW" } });
    if (!response.ok) throw new Error("地址解析伺服器回應異常");

    const data = await response.json();
    if (data && data.display_name) {
      // 整理成清爽的繁體中文地址
      state.address = formatAddress(data);
      dom.addressDisplay.textContent = `📍 ${state.address}`;
    } else {
      fallbackCoordinates(lat, lon);
    }
  } catch (err) {
    fallbackCoordinates(lat, lon);
  }
}

function formatAddress(data) {
  const addr = data.address || {};
  const city = addr.city || addr.town || addr.county || "";
  const district = addr.suburb || addr.district || addr.borough || "";
  const road = addr.road || addr.pedestrian || "";
  const houseNumber = addr.house_number ? `${addr.house_number}號` : "";
  const landmark = addr.attraction || addr.tourism || addr.amenity || "";

  let result = `${city}${district}${road}${houseNumber}`;
  if (landmark) {
    result += ` (${landmark})`;
  }
  return result.trim() || data.display_name;
}

function fallbackCoordinates(lat, lon) {
  state.address = `經緯度座標：${lat.toFixed(6)}, ${lon.toFixed(6)}`;
  dom.addressDisplay.textContent = `📍 ${state.address}`;
}

// 4. 事件監聽綁定
function initEventHandlers() {
  // 快門拍照觸發 (原生高解析度相機)
  dom.nativeCameraInput.addEventListener("change", handleNativePhotoCapture);

  // 切換即時網頁視訊取景模式
  dom.btnWebcamShutter.addEventListener("click", toggleWebcamMode);

  // 預覽分頁切換 (A 印章圖 / B 原圖)
  dom.tabStamped.addEventListener("click", () => switchPreviewTab("stamped"));
  dom.tabClean.addEventListener("click", () => switchPreviewTab("clean"));

  // 預覽功能按鈕
  dom.btnRetake.addEventListener("click", resetPreview);
  dom.btnSaveLocal.addEventListener("click", saveImagesToLocal);
  dom.btnUploadCloud.addEventListener("click", () => uploadImagesToGoogleDrive(false));

  // 設定對話框開關
  dom.btnSettings.addEventListener("click", () => dom.settingsModal.style.display = "flex");
  dom.btnCloseSettings.addEventListener("click", () => dom.settingsModal.style.display = "none");
  dom.btnSaveSettings.addEventListener("click", saveSettings);
}

// 5. 照片拍攝與雙版本處理
async function handleNativePhotoCapture(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  showLoading("正在為照片加上定位與印章...");

  const img = new Image();
  const reader = new FileReader();

  reader.onload = (e) => {
    img.onload = () => {
      processPhoto(img);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);

  // 清空輸入框以利下次拍攝
  dom.nativeCameraInput.value = "";
}

// 拍照核心：生成版本 A (印章圖) 與版本 B (純淨原圖)
function processPhoto(img) {
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;

  // 1. 生成版本 B：純淨原圖
  const cleanCanvas = dom.cleanCanvas;
  cleanCanvas.width = width;
  cleanCanvas.height = height;
  const cleanCtx = cleanCanvas.getContext("2d");
  cleanCtx.drawImage(img, 0, 0, width, height);
  state.cleanImageDataUrl = cleanCanvas.toDataURL("image/jpeg", 0.95);

  // 2. 生成版本 A：旅遊打卡印章圖
  const stampedCanvas = dom.stampedCanvas;
  stampedCanvas.width = width;
  stampedCanvas.height = height;
  const stampedCtx = stampedCanvas.getContext("2d");
  stampedCtx.drawImage(img, 0, 0, width, height);

  // 產生時間戳記字串
  const now = new Date();
  state.currentTimestamp = formatFullDate(now);

  // 在打卡圖上繪製精緻半透明印章卡
  drawTravelStamp(stampedCtx, width, height);
  state.stampedImageDataUrl = stampedCanvas.toDataURL("image/jpeg", 0.95);

  // 3. 顯示預覽
  showPreview();
  hideLoading();

  // 4. 若開啟自動同步，直接觸發上傳
  if (state.autoUpload && state.gasUrl) {
    uploadImagesToGoogleDrive(true);
  }
}

// 繪製精緻的旅行打卡資訊印章
function drawTravelStamp(ctx, width, height) {
  // 依據照片寬度自適應調整字型大小，確保在百萬畫素下清晰易讀
  const scale = Math.max(1, width / 1200);
  const baseFontSize = Math.round(18 * scale);
  const titleFontSize = Math.round(24 * scale);
  const padding = Math.round(20 * scale);
  const cardMargin = Math.round(24 * scale);

  const tripTitle = dom.tripTitleInput.value.trim() || "旅遊生活紀錄";
  const addressText = state.address || "未取得地址資訊";
  const timeText = state.currentTimestamp;
  const coordsText = (state.latitude && state.longitude)
    ? `座標：${state.latitude.toFixed(6)}° N, ${state.longitude.toFixed(6)}° E (±${Math.round(state.accuracy || 0)}m)`
    : "衛星座標抓取中";

  ctx.save();

  // 計算文字高度與卡片尺寸
  const lineHeight = Math.round(28 * scale);
  const cardHeight = Math.round(140 * scale);
  const cardWidth = Math.min(width - (cardMargin * 2), Math.round(800 * scale));
  const cardX = cardMargin;
  const cardY = height - cardHeight - cardMargin;

  // 繪製半透明深灰圓角印章底卡
  ctx.fillStyle = "rgba(18, 18, 18, 0.78)";
  ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
  ctx.shadowBlur = 12 * scale;
  drawRoundRect(ctx, cardX, cardY, cardWidth, cardHeight, 12 * scale);
  ctx.fill();

  // 取消陰影開始寫字
  ctx.shadowBlur = 0;

  // 寫入旅行標題 (亮青色)
  ctx.fillStyle = "#2ed573";
  ctx.font = `bold ${titleFontSize}px "Microsoft JhengHei", sans-serif`;
  ctx.fillText(`🚩 ${tripTitle}`, cardX + padding, cardY + padding + (titleFontSize * 0.8));

  // 寫入詳細地址 (純白清晰)
  ctx.fillStyle = "#ffffff";
  ctx.font = `500 ${baseFontSize}px "Microsoft JhengHei", sans-serif`;
  ctx.fillText(`📍 ${addressText}`, cardX + padding, cardY + padding + titleFontSize + lineHeight);

  // 寫入時間戳記 (暖黃色)
  ctx.fillStyle = "#eccc68";
  ctx.font = `${Math.round(baseFontSize * 0.9)}px "Microsoft JhengHei", sans-serif`;
  ctx.fillText(`🕒 ${timeText}`, cardX + padding, cardY + padding + titleFontSize + (lineHeight * 2));

  // 寫入衛星經緯度 (灰白色)
  ctx.fillStyle = "#ced6e0";
  ctx.font = `${Math.round(baseFontSize * 0.85)}px monospace`;
  ctx.fillText(`🌐 ${coordsText}`, cardX + padding, cardY + padding + titleFontSize + (lineHeight * 2.9));

  ctx.restore();
}

// 輔助繪製圓角矩形
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

// 6. 預覽與分頁切換
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

// 7. 本地照片下載保存 (一鍵存兩張)
function saveImagesToLocal() {
  if (!state.cleanImageDataUrl || !state.stampedImageDataUrl) return;

  const timestampStr = state.currentTimestamp.replace(/[: /]/g, "_");
  
  // 下載版本 A (印章圖)
  downloadDataUrl(state.stampedImageDataUrl, `旅遊打卡印章_${timestampStr}.jpg`);

  // 下載版本 B (純淨原圖)
  setTimeout(() => {
    downloadDataUrl(state.cleanImageDataUrl, `旅遊純淨原圖_${timestampStr}.jpg`);
  }, 400);

  alert("已成功將【版本 A：打卡印章圖】與【版本 B：純淨原圖】存入您的手機！");
}

function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// 8. 雲端同步至 Google 雲端硬碟
async function uploadImagesToGoogleDrive(isSilentAuto) {
  if (!state.gasUrl) {
    if (!isSilentAuto) {
      alert("尚未設定 Google 雲端接收小幫手網址！請先點擊右上角「設定」按鈕貼上網址。");
      dom.settingsModal.style.display = "flex";
    }
    return;
  }

  showLoading(isSilentAuto ? "正在自動同步至 Google 雲端硬碟..." : "正在同步上傳雙版本照片...");

  try {
    const payload = {
      tripTitle: dom.tripTitleInput.value.trim() || "旅遊紀錄",
      timestamp: state.currentTimestamp,
      address: state.address,
      latitude: state.latitude,
      longitude: state.longitude,
      cleanImageBase64: state.cleanImageDataUrl.split(",")[1],
      stampedImageBase64: state.stampedImageDataUrl.split(",")[1]
    };

    const response = await fetch(state.gasUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    hideLoading();

    if (result && result.status === "success") {
      if (!isSilentAuto) {
        alert(`🎉 恭喜小學生！雙版本照片已成功同步至 Google 雲端硬碟！\n雲端資料夾：${result.folderName}`);
      }
    } else {
      throw new Error(result.message || "伺服器未回傳成功狀態");
    }
  } catch (error) {
    hideLoading();
    console.error(error);
    if (!isSilentAuto) {
      alert("上傳 Google 雲端硬碟時發生連線狀況，請確認網路連線或檢查設定網址是否正確。");
    }
  }
}

// 9. 即時網頁視訊取景模式 (Webcam)
async function toggleWebcamMode() {
  if (state.isCameraActive) {
    stopWebcam();
    return;
  }

  try {
    const constraints = {
      video: {
        facingMode: { ideal: "environment" }, // 優先使用手機後置主鏡頭
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    };

    state.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
    dom.cameraVideo.srcObject = state.mediaStream;
    state.isCameraActive = true;
    dom.btnWebcamShutter.textContent = "⏹️ 關閉即時取景";
  } catch (err) {
    alert("無法開啟即時視訊取景。建議使用大圓形【快門拍照】按鈕直接喚醒手機原生相機，畫質更高且最相容！");
  }
}

function stopWebcam() {
  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach((track) => track.stop());
    state.mediaStream = null;
  }
  dom.cameraVideo.srcObject = null;
  state.isCameraActive = false;
  dom.btnWebcamShutter.textContent = "🎥 即時畫面";
}

// 10. 設定存檔
function saveSettings() {
  const url = dom.gasUrlInput.value.trim();
  const auto = dom.autoUploadCheck.checked;

  state.gasUrl = url;
  state.autoUpload = auto;

  localStorage.setItem("travel_camera_gas_url", url);
  localStorage.setItem("travel_camera_auto_upload", auto);

  dom.settingsModal.style.display = "none";
  alert("設定已儲存！");
}

// 工具：格式化完整時間
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
