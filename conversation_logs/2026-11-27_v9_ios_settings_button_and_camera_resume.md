# 2026-11-27 v9 開發紀錄：設定按鈕被擠出 + 預覽後鏡頭卡住

## 使用者原始回報（v8 實測）
> 設定頁 無法點
> 點縮圖 回鏡頭會卡住

## 兩個坑的根因

### 1. 設定按鈕點不到
`.top-bar` 用 flexbox，但 `.top-actions` 沒設 `flex-shrink:0`。iPhone 375px 寬下，標題「旅遊相機 v8 iOS 存檔修復」+ 同步徽章把⚙️擠出可視範圍，加上 `.app-container{overflow:hidden}` 直接把按鈕藏起來，於是永遠點不到。

### 2. 預覽關閉後鏡頭卡住
`previewImg.src = t.stampedUrl` 載入 2560×1920 原始大圖，iOS WKWebView 為了省記憶體自動把背景的 `<video>` 串流暫停。當 modal 用 `display:none` 關閉時，video 不會自動 resume → 鏡頭停在最後一幀。

## v9 修復

### A. top-bar flex 結構補強
```css
.top-bar { gap: 6px; flex-wrap: nowrap; padding: 8px 10px; }
.title-section { min-width: 0; flex: 1 1 auto; overflow: hidden; }
.app-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.top-actions { flex: 0 0 auto; }

@media (max-width: 480px) {
  .version-tag { display: none; }
  #cloudSyncBadge { max-width: 86px; overflow: hidden; }
}
```

### B. open/closePreviewModal 保護鏡頭
```js
function openPreviewModal() {
  if (isIOS) try { dom.cameraVideo.pause(); } catch (e) {}
  ...
}

function closePreviewModal() {
  dom.previewModal.style.display = "none";
  try { dom.previewImg.removeAttribute("src"); } catch (e) {}
  if (dom.cameraVideo.srcObject) {
    dom.cameraVideo.play().catch(() => startCamera());
  }
}
```

## 修改檔案

| 檔案 | 狀態 |
|------|------|
| `v9/app.js` | open/closePreviewModal 加鏡頭 pause/play、清空 previewImg.src |
| `v9/style.css` | top-bar 收縮規則、窄螢幕隱藏 version-tag |
| `v9/index.html` | 版本號 v9、tips 更新 |
| `v9/google_drive_receiver.gs` | 完全沿用 v7/v8 |
| `v9/README.md` | 新建 |
| 根目錄三檔 | 同步 v9 |

v1 ~ v8 完整保留；GAS 接收器未變動，無需重新部署。

## iPhone 實測 checklist
- [ ] 右上⚙️設定按鈕清楚可見、可點
- [ ] 拍照 → 點縮圖 → 關閉預覽 → 鏡頭自動恢復播放不卡住
- [ ] 預覽內按 💾 → 彈分享表 → 取消或完成後關預覽 → 鏡頭仍動
- [ ] 連拍 5~10 下，鏡頭穩定
