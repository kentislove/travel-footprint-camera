# 2026-11-27 v8 開發紀錄：iPhone 相簿存檔與上傳速度修復

## 使用者原始回報
> iPhone 拍照完並無法自動存檔到手機內，上傳有但是很慢，而且手動存檔會一直跳出下載畫面導致拍照視窗中斷。

## 三個核心問題

| # | 症狀 | 根本原因 |
|---|------|---------|
| 1 | 拍完無法進相簿 | iOS WebKit 不支援 `<a download>` 真正存到照片 App，只會開新分頁預覽 |
| 2 | 手動存檔打斷鏡頭 | v7 連續 `a.click()` 兩次，iOS 彈兩次下載對話框導致鏡頭被釋放 |
| 3 | 上傳慢 | 整張原生最大畫素 JPEG（~2MB）直接 base64 送 GAS，單張耗時 10~20 秒 |

## v8 解法

### 1. Web Share API Level 2
iOS 唯一合法存相簿管道是 `navigator.share({ files: [File] })`，呼叫系統原生分享表：

```js
if (isIOS && canShareFiles) {
  const stampedFile = new File([task.stampedBlob], name, { type: "image/jpeg" });
  const cleanFile = new File([task.cleanBlob], name2, { type: "image/jpeg" });
  if (navigator.canShare({ files: [stampedFile, cleanFile] })) {
    await navigator.share({ files: [stampedFile, cleanFile], title, text });
  }
}
```

使用者看到分享表後點「儲存影像」就會進照片 App。一次呼叫傳兩個 File，不會跳兩次對話框。

### 2. 上傳版本縮小
拍照同時產兩組 blob：
- 本地存檔：原生最大（2560px）/ JPEG 0.90（~1.5MB）
- 雲端上傳：1920px / JPEG 0.82（~400KB）

base64 大小從 ~2.6MB 降到 ~530KB，GAS 傳輸速度約快 5 倍。

### 3. iPhone 鎖住自動下載
```js
if (isIOS) {
  dom.autoDownloadCheck.checked = false;
  dom.autoDownloadCheck.disabled = true;
  state.autoDownload = false;
}
```
UI 鎖住 + state 強制 false + 拍照時再次 `state.autoDownload && !isIOS` 雙保險。

### 4. fetch 加 timeout
```js
function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  ...
}
```
45 秒超時避免 GAS 冷啟動卡死整個佇列。

## 修改檔案

| 檔案 | 狀態 |
|------|------|
| `v8/app.js` | 新建（Web Share + 上傳縮小 + timeout + iOS 鎖下載） |
| `v8/index.html` | 新建（版本號 v8） |
| `v8/style.css` | 從 v7 複製（無變動） |
| `v8/google_drive_receiver.gs` | 從 v7 複製（接收器無變動） |
| `v8/README.md` | 新建 |
| 根目錄三檔 | 同步 v8 |

v1 ~ v7 完整保留。

## iPhone 實測 checklist
- [ ] 連拍 10 下，鏡頭不中斷，不會彈下載對話框
- [ ] 設定頁「拍照時自動下載到手機相簿」是灰色鎖住
- [ ] 點縮圖 → 💾 存入手機相簿 → 彈出 iOS 原生分享表，有「儲存影像」
- [ ] 單張上傳在 2~5 秒內清掉佇列
- [ ] GAS 冷啟動卡 30 秒以上時自動 abort 並 3 秒後重試

## 已知限制
- 使用者若按分享表的「取消」，v8 不會自動退回 download 連結，避免中斷鏡頭。要重新存檔請再次點「💾」。
- 真的找到不支援 Web Share Level 2 的 iOS（iOS 14 以下），會 alert 提示「請在預覽視窗長按圖片 → 儲存影像」。
