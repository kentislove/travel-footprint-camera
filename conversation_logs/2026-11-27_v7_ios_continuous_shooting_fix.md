# 2026-11-27 v7 開發紀錄：iPhone Chrome 連拍修復

## 使用者原始需求
> iPhone 開啟網頁無法連續拍照。請預設我都是使用 Chrome 開啟，不管是 Android 或者 iPhone。

## 關鍵背景（必讀）
iOS 上的所有瀏覽器（Chrome / Edge / Firefox / Brave…）都被 Apple 強制套用 **WebKit 引擎**，所以 iPhone Chrome ≈ Safari。這個差異會貫穿整個修復方案。

## 問題診斷（v6 的四個癥結）

| # | 問題 | 影響 |
|---|------|------|
| 1 | `canvas.toDataURL` 同步阻塞（iOS 上一張 12MP ≈ 1-2 秒） | 快門按了沒反應，連拍失敗 |
| 2 | iOS WebView 記憶體 ~400MB 上限，base64 又多佔 33% | 拍到第 2-3 張鏡頭串流被回收 |
| 3 | `applyConstraints({ advanced: [{ width, height }] })` 在 iOS throw | 解析度設定失敗，後續邏輯錯亂 |
| 4 | 全頁共用兩個 `<canvas>` | 連拍時下一張覆蓋上一張 pixel data |

## v7 解法

### 1. toBlob 替換 toDataURL
```js
function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => b ? resolve(b) : reject(…), type, quality);
  });
}
```
JPEG 編碼交給瀏覽器 worker，主執行緒 50ms 內恢復可按。

### 2. iOS 安全解析度 2560px
```js
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
              (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const IOS_SAFE_MAX_DIM = 2560;
```

### 3. 每張獨立 canvas
```js
const cleanCanvas = document.createElement("canvas");
const stampedCanvas = document.createElement("canvas");
```
不再共用 `#cleanCanvas` / `#stampedCanvas`，隱藏元素留著不會干擾。

### 4. applyConstraints 改單層語法
```js
await track.applyConstraints({
  width: { ideal: maxW },
  height: { ideal: maxH }
});
```

### 5. 預覽走 ObjectURL
- `task.cleanUrl = URL.createObjectURL(cleanBlob)`
- `<img src>` 直接吃 blob URL
- 上傳 GAS 時才呼叫 `FileReader.readAsDataURL(blob)` 轉 base64

## 修改檔案

| 檔案 | 狀態 |
|------|------|
| `v7/app.js` | 全重寫（toBlob + ObjectURL + iOS 偵測） |
| `v7/index.html` | 版本號、標題改為 v7 |
| `v7/style.css` | 從 v6 複製（無變動） |
| `v7/google_drive_receiver.gs` | 從 v6 複製（無變動） |
| `v7/README.md` | 新建 |
| 根目錄 `app.js / index.html / style.css` | 同步 v7 |

v1 ~ v6 完整保留。GAS 接收器未變動，無需重新部署。

## iPhone 實測 checklist
- [ ] 連按快門 5-10 下，每張都被記錄
- [ ] 解析度徽章顯示 2560×1920 (4.9MP) 或更高
- [ ] 背景同步徽章正常顯示「同步中 (N 張)…」→「全部已同步」
- [ ] 縮放滑桿可用（iOS 不支援原生 zoom 會自動退回數位縮放）
