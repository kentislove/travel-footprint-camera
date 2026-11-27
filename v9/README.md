# 旅遊相機 v9 — iOS 設定按鈕與鏡頭保護修復

**版本日期**：2026-11-27
**基於版本**：v8（iPhone 相簿存檔 + 上傳提速）
**核心訴求**：修復 v8 在 iPhone 上兩個實測發現的災情。

---

## 🐞 v8 實測回報

| 症狀 | 根本原因 |
|------|----------|
| 設定⚙️按鈕點不到 | top-bar 是 flexbox 但 `.top-actions` 沒設 `flex-shrink:0`。標題「旅遊相機 v8 iOS 存檔修復」+ 同步徽章在 iPhone 窄螢幕（375px）下把右側按鈕擠出可視範圍，`.app-container{overflow:hidden}` 把它藏起來 → 永遠點不到。 |
| 點縮圖後回鏡頭卡住 | `previewImg.src` 載入 2560×1920 原始大圖，iOS WKWebView 為了省記憶體自動暫停背景 `<video>` 串流；關閉預覽時 `display:none` 不會自動 resume video。結果鏡頭停格。 |

---

## ✅ v9 修復

### 1. top-bar 結構補強（style.css）
```css
.top-bar { gap: 6px; flex-wrap: nowrap; padding: 8px 10px; }
.title-section { min-width: 0; flex: 1 1 auto; overflow: hidden; }
.app-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.top-actions { flex: 0 0 auto; }  /* 永遠不被壓縮 */

@media (max-width: 480px) {
  .version-tag { display: none; }       /* 窄螢幕把版本標籤讓出 */
  #cloudSyncBadge { max-width: 86px; overflow: hidden; }
}
```

### 2. 鏡頭記憶體保護（app.js）
```js
function openPreviewModal() {
  // iOS：進預覽前先暫停 video，讓大圖解碼有空間
  if (isIOS) dom.cameraVideo.pause();
  ...
}

function closePreviewModal() {
  dom.previewModal.style.display = "none";
  dom.previewImg.removeAttribute("src");    // 立刻釋放大圖記憶體
  if (dom.cameraVideo.srcObject) {
    dom.cameraVideo.play().catch(() => startCamera()); // 失敗就整條重啟
  }
}
```

---

## 🧪 iPhone 實測 checklist

- [ ] 右上⚙️設定按鈕清楚可見、可點
- [ ] 設定 modal 出現後，灰色鎖住的「自動下載」下方仍有黃字提示
- [ ] 拍 1 張 → 點縮圖 → 看到預覽 → 點右上 × 關閉 → 鏡頭串流**自動恢復播放**不卡住
- [ ] 預覽中點 💾 → 彈出 iOS 原生分享表（Web Share API）→ 取消或儲存後關掉預覽 → 鏡頭仍然會動
- [ ] 連拍 5-10 下 → 鏡頭不會自己停

## 📁 檔案清單

| 檔案 | 說明 |
|------|------|
| `app.js` | open/closePreviewModal 新增鏡頭 pause/play、清空 previewImg.src |
| `style.css` | top-bar flex 結構補強、窄螢幕隱藏版本標籤 |
| `index.html` | 版本號 v9、tips 更新 |
| `google_drive_receiver.gs` | 完全沿用 v7/v8（GAS 不用重新部署） |

v1 ~ v8 完整保留，根目錄三檔同步 v9 供 GitHub Pages 發布。

## 🔙 回滾

若 v9 又出現意料外行為，把根目錄三檔換回 `v8/` 內容即可（v8 的三大修復仍在）。
