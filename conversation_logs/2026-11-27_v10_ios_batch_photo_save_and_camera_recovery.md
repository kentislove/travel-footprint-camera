# 2026-11-27 v10 開發紀錄：連拍批次存相簿 + 鏡頭硬救

## 使用者原始回報（v9 實測）
> 1. 設定頁應該要有兩個勾選紐 選不到第二個
> 2. 連續拍照 應該要自動存檔在相簿 但是我打開相簿沒有
> 3. 當我點擊存檔後 只有當下畫面的那一張 但是前面連續拍照的沒有
> 4. 當我回到拍照鏡頭主畫面 整個畫面不動 卡住

## 根因分析

| # | 根因 |
|---|------|
| 1 | v8 的 `autoDownloadCheck.disabled=true` 鎖死，v9 延續 |
| 2 | iOS Web Share API 強制要 user activation（人工點）才能呼叫；網頁絕對無法背景自動存相簿，這是 Apple 的政策不是 bug |
| 3 | `saveCurrentViewingToLocal` 只處理 `state.currentViewingPhoto`（最新一張），其他拍過的都沒追蹤 |
| 4 | iOS `video.play()` 常回傳 resolved promise 卻實際沒動；`.catch()` 永遠不會觸發，`startCamera()` 兜底也救不到 |

## v10 四大重做

### A. 待存佇列 + 批次 share
```js
// state 新增
pendingLocalSaves: [],
includeClean: localStorage.getItem("travel_camera_include_clean") !== "false"

// 拍照後入列
state.pendingLocalSaves.push(task); updatePendingBadge();

// 一次 share 全部
async function saveAllPendingToLocal() {
  const files = [];
  for (const task of state.pendingLocalSaves) {
    files.push(new File([task.stampedBlob], ...));
    if (state.includeClean) files.push(new File([task.cleanBlob], ...));
  }
  await navigator.share({ files, ... });
  clearPendingSaves();
}
```

### B. 鏡頭硬救（不信 play() 的回傳值）
```js
setTimeout(() => {
  const v = dom.cameraVideo;
  const needRestart = !v.srcObject
    || v.readyState < 2
    || !state.mediaStream
    || !state.mediaStream.active
    || v.paused;
  if (needRestart) startCamera();
  else v.play().catch(() => startCamera());
}, 80);
```

### C. 設定頁解鎖
- 移除 `autoDownloadCheck.disabled = true`
- 新增 `includeCleanCheck`（第 2 個勾選鈕，預設 ON）
- iOS 下自動下載選項旁顯示黃字說明「iPhone 無效」

### D. 縮圖右上角紅圈角標 + 💾 按鈕文字動態變化
- `.pending-badge` CSS 紅圈顯示未存張數
- 💾 按鈕文字 `💾 存入相簿 (N 張未存)`

## 修改檔案

| 檔案 | 狀態 |
|------|------|
| `v10/app.js` | 待存佇列 + saveAllPendingToLocal + 鏡頭硬救 + initSettings 解鎖 |
| `v10/index.html` | pendingBadge + includeCleanCheck + v10 tips |
| `v10/style.css` | `.pending-badge` CSS + wrapper overflow:visible |
| `v10/google_drive_receiver.gs` | 沿用 |
| `v10/README.md` | 新建 |
| 根目錄三檔 | 同步 v10 |

v1~v9 完整保留。

## iPhone 實測 checklist
- [ ] 設定兩個主要勾選鈕都能點
- [ ] 連拍 5 下，縮圖紅圈顯示 5
- [ ] 💾 按鈕變成「💾 存入相簿 (5 張未存)」
- [ ] 按 💾 → 分享表顯示 10 個影像 → 儲存 → 全進相簿 → 紅圈消失
- [ ] 關閉預覽 → 鏡頭自動恢復或重建，不卡住
