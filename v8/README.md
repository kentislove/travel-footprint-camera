# 旅遊相機 v8 — iPhone 相簿存檔與上傳提速修復版

**版本日期**：2026-11-27
**基於版本**：v7（iOS 連拍修復）
**核心訴求**：修復 iPhone「拍完無法存到相簿」「手動存檔打斷鏡頭」「上傳很慢」三大痛點。

---

## 📱 iPhone 三個坑的根本原因

### 1. 無法自動存到相簿
iOS Safari/Chrome **根本不支援**用 `<a download>` 直接存進相簿 App。
- 桌機/Android：`<a download>` 會真的下載檔案到預設資料夾
- iOS：`<a download>` 只會開新分頁預覽圖片，根本不會進相簿

v7 又連續點了兩次下載（打卡圖 + 純淨原圖），於是 iOS 連續跳兩次下載對話框，鏡頭當然中斷。

### 2. 上傳慢
v7 把原生最大畫素（iPhone 2560×1920 ≈ 1.5MB JPEG）整張 base64 送到 GAS，一張編碼後 ~2MB，GAS 又是冷啟動，整條佇列卡住。

### 3. 自動下載打斷連拍
每拍一張就 `a.click()` 兩次，iOS 每次都會彈下載詢問，鏡頭串流被打斷甚至被釋放。

---

## ✅ v8 三大修復

### 1. iPhone 存檔走 Web Share API
```js
if (isIOS && canShareFiles) {
  const stampedFile = new File([task.stampedBlob], "...", { type: "image/jpeg" });
  const cleanFile = new File([task.cleanBlob], "...", { type: "image/jpeg" });
  if (navigator.canShare({ files: [stampedFile, cleanFile] })) {
    await navigator.share({ files: [stampedFile, cleanFile], title, text });
  }
}
```
點「💾 存入手機相簿」→ iOS 彈出**原生系統分享表** → 使用者點「儲存影像」或「儲存到檔案」→ 真的進照片 App。這是 iOS 唯一合法的存檔管道。

### 2. 上傳縮小版本
拍照同時產出兩份 blob：
- **本地存檔版**：原生最大畫素（2560px）JPEG 品質 0.90 → 進相簿是這份
- **雲端上傳版**：縮到 1920px、JPEG 品質 0.82 → 大約 300~500KB/張

單張上傳 base64 從 ~2.6MB 掉到 ~500KB，整條佇列加速約 5 倍。

### 3. iPhone 停用自動下載
`initSettings()` 偵測到 iOS 就把「拍照時自動下載到手機相簿」勾選框**鎖住並顯示紅字提示**，從根本斷絕自動下載在 iOS 的觸發路徑。拍完不再被下載對話框打斷。

### 額外：fetch 加 45 秒 timeout
GAS 冷啟動常常卡 20-30 秒，v7 沒 timeout 時整個佇列可能永遠停擺。v8 用 `AbortController` + 45 秒超時，失敗後 3 秒重試。

---

## 🧪 iPhone 實測重點

1. **連拍 10 下不被打斷**：按快門連按，每次都該只出現一次閃光 + Toast，不會有任何下載對話框。
2. **點縮圖 → 💾**：應該彈出 iOS 原生分享表，有「儲存影像」「儲存到檔案」「AirDrop」等選項。
3. **上傳速度**：底部徽章「同步中 (N 張)…」應該在 2~5 秒內就減 1；10 張連拍預期 30 秒內清空。
4. **設定頁**：自動下載勾選框應該是灰色無法勾選，下面有黃字提示。

---

## 📁 檔案清單

| 檔案 | 說明 |
|------|------|
| `app.js` | Web Share API + 上傳縮小 + fetch timeout + iOS 鎖自動下載 |
| `index.html` | 版本號改為 v8、設定頁說明更新 |
| `style.css` | 完全沿用 v7 |
| `google_drive_receiver.gs` | 完全沿用 v7（無須重新部署 GAS） |

v1 ~ v7 完整保留；根目錄三個檔同步 v8 供 GitHub Pages 發布。

---

## 🔙 回滾

若 v8 在特定 iPhone 型號反而異常，把根目錄三檔換回 `v7/` 內容即可。
