# 旅遊相機 v10 — iPhone 連拍批次存相簿 + 鏡頭硬救

**版本日期**：2026-11-27
**基於**：v9（鏡頭保護 + top-bar 修復）
**訴求**：解決使用者實測 v9 時發現的 4 大問題。

---

## 🐞 v9 的 4 個問題

| # | 症狀 | 根因 |
|---|------|------|
| 1 | 設定頁第 2 個勾選鈕選不到 | v8/v9 把它 `disabled=true` 鎖住 |
| 2 | 連拍不會自動進相簿 | iOS Web Share API 強制要「使用者手點」才能呼叫，不可能背景自動存 |
| 3 | 點 💾 只存當下一張 | 程式只讀 `currentViewingPhoto`，沒有待存佇列概念 |
| 4 | 回鏡頭主畫面卡住 | `video.play()` 在 iOS 常回傳 resolved promise 但實際沒動，catch 救不到 |

---

## ✅ v10 四大重做

### 1. 連拍批次存相簿（核心）
```js
state.pendingLocalSaves = [];  // 待存佇列

// 每拍一張自動入列
Promise.all([...編碼...]).then(task => {
  state.pendingLocalSaves.push(task);
  updatePendingBadge();  // 縮圖右上紅圈顯示未存張數
});

// 按 💾 時一次 share 全部
async function saveAllPendingToLocal() {
  const files = [];
  for (const task of state.pendingLocalSaves) {
    files.push(new File([task.stampedBlob], `打卡印章_${t}.jpg`, {...}));
    if (state.includeClean) files.push(new File([task.cleanBlob], ...));
  }
  await navigator.share({ files, ... });  // iOS 一次全塞分享表
  clearPendingSaves();
}
```

### 2. 第 2 個勾選鈕解鎖且有新語意
- 原本：`拍照時自動下載到手機相簿`（iOS 鎖住無效）
- 現在：**新增**「存入相簿時同時包含『純淨原圖 B』」（預設 ON）
- 舊的「自動下載」仍在，但明確標示僅 Android/桌機有效 + iOS 下方黃字說明為何無效

### 3. 鏡頭硬救（closePreviewModal）
```js
setTimeout(() => {
  const v = dom.cameraVideo;
  const needRestart = !v.srcObject
    || v.readyState < 2
    || !state.mediaStream
    || !state.mediaStream.active
    || v.paused;
  if (needRestart) startCamera();   // 整條重建，不信任 play()
  else v.play().catch(() => startCamera());
}, 80);
```

### 4. UI 上角標與按鈕語意
- 縮圖右上紅圈：顯示未存張數（1、2、3…99+）
- 💾 按鈕文字動態變化：`💾 存入相簿` / `💾 存入相簿 (3 張未存)`
- 待存佇列在分享成功後自動清空；使用者按「取消」則保留

---

## 📝 iPhone 真相聲明

iOS WebKit 對 `navigator.share()` 有一條**硬限制**：必須在使用者剛剛點擊 /觸控的 handler 當下呼叫（user activation）。這意味著：
- ❌ 不能定時器觸發
- ❌ 不能收到網路回應後觸發
- ❌ 不能「每拍一張就自動分享」（因為拍照本身已經是一次 user activation，但 await 編碼完就超時了）

**唯一合法流程**：拍一堆 → 使用者點一下 💾 → 一次把全部塞進分享表 → 按「儲存 N 個影像」。

v10 完全擁抱這個設計，不再對抗平台。

---

## 🧪 iPhone 實測 checklist

- [ ] 右上⚙️打開設定，**兩個勾選鈕都能點**（啟用背景同步、同時存純淨原圖 B）
- [ ] 第 3 個勾選鈕（自動下載）下方有黃字說明「iPhone 無效」
- [ ] 連拍 5 下，左下縮圖右上角紅圈顯示 `5`
- [ ] 點縮圖 → 💾 按鈕文字變成「💾 存入相簿 (5 張未存)」
- [ ] 按 💾 → iOS 分享表彈出，顯示「10 個影像」（5 張打卡圖 + 5 張純淨原圖）
- [ ] 按「儲存 10 個影像」→ 全部進相簿 → 紅圈消失
- [ ] 關閉預覽 → 鏡頭自動恢復取景，不卡住（必要時自動重啟）
- [ ] 若按「取消」→ Toast「已取消存檔（待存佇列保留）」→ 紅圈仍在

## 📁 檔案清單
- `app.js` — 待存佇列、批次 share、鏡頭硬救、設定解鎖
- `index.html` — 第 2 勾選鈕、角標、v10 tips
- `style.css` — 角標 CSS + `thumbnail-wrapper` overflow:visible
- `google_drive_receiver.gs` — 完全沿用 v7/v8/v9（GAS 不動）

v1 ~ v9 完整保留。根目錄三檔同步 v10 給 GitHub Pages。
