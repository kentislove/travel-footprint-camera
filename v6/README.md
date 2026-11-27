# 旅遊相機 v6 — 最大畫素探測 + 縮放控制

**版本日期**：2026-11-27
**基於版本**：v5（背景無感秒拍與非阻塞上傳佇列版）
**核心訴求**：解決「畫質很差、無法縮放」的問題。

---

## 🎯 v6 相對 v5 的三大升級

### 1. 自動探測裝置鏡頭的「最大畫素」

**v5 的問題**：
`getUserMedia({ video: { facingMode } })` 完全沒指定解析度，瀏覽器會自動給預設值，多數機型只給 **640×480** 或 **1280×720**，再加上 `MAX_IMAGE_DIMENSION = 1920` 把大於 1920 的畫面強制縮小 → 拍出來的照片畫質很差。

**v6 做法（兩段式開啟）**：
1. 先用 `getUserMedia` 配合 `width: { ideal: 4096 }` 開啟鏡頭。
2. 從 `track.getCapabilities()` 讀出該鏡頭支援的 `width.max` / `height.max`。
3. 呼叫 `track.applyConstraints({ advanced: [{ width: maxW, height: maxH }] })` 把實際輸出拉到裝置極限。
4. 拍照用 Canvas 的原生解析度存檔，**不再縮水**，JPEG 品質提升到 **0.95**。

→ 典型旗艦手機後鏡頭可達 **4000×3000（1200 萬畫素）或更高**，螢幕右上角會即時顯示當前解析度徽章。

### 2. 縮放控制（Zoom）—— 兩層退場機制

**原生縮放（優先）**：
讀 `track.getCapabilities().zoom`，若回傳 `{ min, max, step }` 代表裝置支援硬體/原生數位變焦（多數 Android Chrome、iOS Safari 16+ 都有），直接用 `applyConstraints({ advanced: [{ zoom: value }] })` 控制。這是「真正的變焦」，畫質最好。

**數位縮放（退場）**：
裝置不支援 `zoom` 能力時（例如舊 iOS），退回 Canvas 中央裁切做數位縮放：
- 預覽：用 CSS `transform: scale(z)` 放大 `<video>`。
- 拍照：在 Canvas 用 `drawImage(video, srcX, srcY, srcW, srcH, …)` 從中心裁切保留原始畫素，而不是先截圖再放大，所以仍保有原生解析度。

### 3. 使用介面強化

- 右側垂直滑桿 + / − 按鈕。
- 右上角倍率顯示（例：`2.3x`）。
- 觀景窗兩指捏合（pinch-to-zoom）同步觸發。
- 定位狀態列右側新增解析度徽章（例：`4032×3024 (12.2MP)`）。

---

## 🗂️ 檔案清單

| 檔案 | 說明 |
|------|------|
| `app.js` | 核心邏輯（新增 `applyMaxResolution`、`detectZoomCapability`、`setZoom`、`applyDigitalZoomPreview`） |
| `index.html` | 介面（新增 `#zoomPanel`、`#resolutionBadge`） |
| `style.css` | 樣式（底部新增縮放面板與徽章） |
| `google_drive_receiver.gs` | Google Apps Script 接收器（沿用 v5，無須重新部署） |

---

## 🧪 如何測試

1. 用手機瀏覽器（Chrome / Safari）開啟 GitHub Pages 連結（新網址：`?v=6`）。
2. 允許相機與定位權限。
3. 觀察定位列右側徽章：應該會顯示實際拉到的解析度（例如 `4000×3000 (12.0MP)`）；若顯示 `640×480` 代表裝置不允許拉高，需檢查瀏覽器權限或改用其他瀏覽器。
4. 拖動右側滑桿或兩指捏合 → 觀景窗畫面會放大，倍率即時更新。
5. 按紅色快門 → 快拍 Toast 會顯示實際存檔的畫素（例：`✓ 已拍下 4000×3000 (12.0MP)`）。
6. 點左下角縮圖檢視 → 檔案畫質應明顯優於 v5。

---

## ⚠️ 已知限制

- 部分低階 Android 瀏覽器 `getCapabilities` 回傳空值，會退回「相機自選預設」，最大畫素可能卡在 720p。
- iOS Safari 的 `zoom` 能力在 16 以前版本一律不支援；v6 會自動改用數位縮放。
- 單張照片體積從 v5 約 300KB 增加到 **1.5~3MB**，上傳時間延長但背景佇列已經設計成不擋拍照。

---

## 🔙 回滾路徑

v6 的所有修改都獨立在 `v6/` 資料夾內，根目錄的 `app.js / index.html / style.css` 也一併同步到 v6。若需要回到 v5，直接把根目錄三個檔案換回 `v5/` 內容即可，v1 ~ v5 資料夾皆完整保留。
