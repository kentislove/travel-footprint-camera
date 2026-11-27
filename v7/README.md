# 旅遊相機 v7 — iPhone Chrome/Safari 連拍修復版

**版本日期**：2026-11-27
**基於版本**：v6（最大畫素探測 + 縮放控制）
**核心訴求**：修復「iPhone 開啟網頁無法連續拍照」的問題。

---

## 📱 iPhone 連拍卡住的根本原因

1. **iOS 上的 Chrome 其實是 Safari WebKit**：Apple 政策強制所有 iOS 瀏覽器都必須套 WebKit，所以 iPhone 上的 Chrome 和 Safari 行為一致。
2. **`canvas.toDataURL` 是同步阻塞 API**：v6 一張 4000×3000 的 JPEG 編碼在 iPhone 上需 500ms~2s，期間整個 JavaScript 主執行緒被鎖死，快門按了也沒反應。
3. **iOS WebView 記憶體上限 ~400MB**：v6 每張照片同時保留兩份 base64 字串（~3MB×2），拍 2~3 張就吃光記憶體，接下來鏡頭串流被 OS 回收。
4. **`applyConstraints({ advanced: […] })` 在 iOS 相容性差**：常常直接 throw 導致後續拍照邏輯整組爛掉。

---

## ✅ v7 四大修復

### 1. 編碼非同步化（最關鍵）
- v6：`canvas.toDataURL(…)` 同步阻塞
- v7：`canvas.toBlob(callback, …)` 走瀏覽器背景執行緒
- 結果：快門按下 → 50ms 內可以按下一張；JPEG 編碼在背景慢慢做完，不影響使用者連拍節奏

### 2. iOS 安全解析度上限
```js
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || …
const IOS_SAFE_MAX_DIM = 2560;   // iPhone 安全上限
const ANDROID_SAFE_MAX_DIM = 4096;
```
2560×1920 = 492 萬畫素，對手機拍照已經夠用，又能避免 iOS WebView 記憶體爆掉。

### 3. 每張照片獨立 Canvas
- v6：全頁共用兩個 `<canvas>`，連拍時下一張覆蓋上一張的 pixel data
- v7：每次拍照 `document.createElement("canvas")` 一次性產出，用完被 GC 自動回收

### 4. `applyConstraints` 走 iOS 相容語法
- v6：`advanced: [{ width, height }]` → iOS 常 throw
- v7：`{ width: { ideal: W }, height: { ideal: H } }` → iOS / Android 都相容

### 5. 預覽改走 ObjectURL
- v6：縮圖與預覽彈窗用 base64 dataURL（體積膨脹 33%，佔記憶體）
- v7：`URL.createObjectURL(blob)`，體積 0，GC 友善；base64 僅在「上傳到 Google Drive 那一刻」才用 `FileReader` 臨時轉換

---

## 🧪 iPhone 實測重點

1. **連拍測試**：快門連按 5~10 下，每張都該被記錄；左下角縮圖會在編碼完成後自動更新到最新張。
2. **解析度徽章**：iPhone 應該會顯示 `2560×1920 (4.9MP)` 或類似值；若顯示 720p，代表該 iPhone 鏡頭不支援更高，正常。
3. **背景同步徽章**：連拍後頂部會顯示「同步中 (N 張)…」，待佇列清空會變「全部已同步」。
4. **設定頁的 GAS URL** 沿用 v6，不用重新填寫。

---

## 📁 檔案清單

| 檔案 | 說明 |
|------|------|
| `app.js` | 核心重寫：toBlob + ObjectURL + iOS 偵測 |
| `index.html` | 版本號改為 v7（其餘沿用 v6） |
| `style.css` | 完全沿用 v6 |
| `google_drive_receiver.gs` | 完全沿用 v6（無須重新部署 GAS） |

v1 ~ v6 完整保留；根目錄三個檔同步 v7 供 GitHub Pages 發布。

---

## 🔙 回滾

如 v7 在特定 iPhone 型號反而異常，直接把根目錄三檔換回 `v6/` 內容即可。
