# 2026-11-27 v6 開發紀錄：最大畫素探測與縮放控制

## 使用者原始需求
> 檢查一下開發對話，在最新的版本中，拍照沒有辦法調整縮放，畫質很差。能不能依照開啟網頁端的手機端或是行動端的機器，找出最大的畫素做拍照的存底跟存檔的動作？

## 問題診斷（v5 的三個癥結）

1. **沒有要求高解析度**：`getUserMedia({ video: { facingMode } })` 完全沒指定寬高，瀏覽器預設只給 640×480 或 720p。
2. **強制縮小**：`MAX_IMAGE_DIMENSION = 1920` 把任何大於 1920px 的畫面在 Canvas 階段縮小。
3. **沒有縮放**：UI 完全沒有縮放元件，也沒有呼叫 `MediaStreamTrack.applyConstraints({ zoom })`。
4. **JPEG 品質 0.85** 偏低。

## v6 解法

### 兩段式開啟鏡頭
```js
// 1. 先用 ideal:4096 開啟
stream = await navigator.mediaDevices.getUserMedia({
  video: { facingMode: { ideal }, width: { ideal: 4096 }, height: { ideal: 4096 } }
});
// 2. 讀 track.getCapabilities().width.max / height.max
// 3. applyConstraints({ advanced: [{ width: maxW, height: maxH }] }) 拉到極限
```

### 縮放控制
- `caps.zoom` 存在 → 用原生 `applyConstraints({ advanced: [{ zoom }] })`
- 否則退回 CSS transform 預覽 + Canvas 中央裁切拍照（`drawImage(video, sx, sy, sw, sh, …)`）

### 存檔
- 目標寬高 = 原生寬高（不再縮水）
- JPEG 品質 `0.95`

### 新 UI 元件
- `#resolutionBadge`（即時解析度徽章）
- `#zoomPanel`（右側垂直滑桿 + 上下按鈕 + 倍率顯示）
- 兩指捏合手勢綁定 `#viewportArea`

## 修改檔案

| 檔案 | 狀態 |
|------|------|
| `v6/app.js` | 新建 |
| `v6/index.html` | 新建 |
| `v6/style.css` | 從 v5 複製 + 追加 v6 樣式 |
| `v6/google_drive_receiver.gs` | 從 v5 複製（接收器無變動） |
| `v6/README.md` | 新建版本說明 |
| 根目錄 `app.js / index.html / style.css` | 同步成 v6（供 GitHub Pages） |

v1 ~ v5 資料夾完整保留，未刪除任何舊檔。

## 後續建議

- 旗艦機實測若還是只給 720p，可能是該瀏覽器對該網域限制；請改用 Chrome 或 Safari 最新版，並確認網頁從 HTTPS（GitHub Pages）載入。
- 單張檔案從 ~300KB 增加到 1.5~3MB，上傳時間變長，但背景佇列不會擋拍照。
- 若 Google Apps Script 遇到 base64 過大截斷，可考慮未來改走 resumable upload；目前 1200 萬畫素 JPEG 約 2~3MB 仍在 GAS 單次 POST 可接受範圍。
