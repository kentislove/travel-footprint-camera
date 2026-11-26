# 旅遊足跡相機 (v2) - 版本說明與 GitHub Pages 部署文件

---

## 1. 版本基本資訊
- **版本號**：v2
- **建立日期**：2026 年 11 月 26 日
- **作者/角色**：AI 老師（為小學生量身打造）
- **核心升級**：
  1. 內建綁定小學生親自部署成功的 Google Apps Script 網頁應用程式接收端。
  2. 免手動設定：手機一開啟網頁即可直接拍照自動上傳至 Google 雲端硬碟。
  3. 配置 GitHub Pages 部署架構，提供公開 HTTPS 網址給 iPhone 與 Android 裝置隨時取用。

---

## 2. 本版本核心變更點 (Changelog)
- **預設雲端接收網址整合**：
  - 在 `app.js` 中將預設接收端點設定為：
    `https://script.google.com/macros/s/AKfycbxr3Zv5jRHXevBRVQdpJ1zINvYndnYtrsW6gfOg2-gGaf9pEXYWCLNkQECkirh-2X_OIw/exec`
  - 即使使用者在全新手機的無痕模式打開，也能免輸入網址直接連動 Google 雲端硬碟！
- **GitHub Pages 部署準備**：
  - 根目錄自動映射 v2 最新版本靜態檔案，支援 GitHub Pages 免伺服器全自動託管。

---

## 3. 檔案變更清單
- `v2/app.js`：已更新預設端點與自動填入邏輯。
- `v2/index.html`：前端介面。
- `v2/style.css`：旅行相機樣式。
- `v2/google_drive_receiver.gs`：Google Apps Script 接收端（小學生已成功部署）。
- `v2/README.md`：本版本說明文件。
