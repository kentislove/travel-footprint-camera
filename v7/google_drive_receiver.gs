/**
 * 旅遊足跡相機 - Google 雲端硬碟自動接收小幫手 (google_drive_receiver.gs)
 * 
 * 【用意】
 * 這是部署在您個人 Google 帳號內的免費雲端程式碼。
 * 負責接收從手機網頁端傳過來的照片資料，自動在 Google 雲端硬碟分門別類存好。
 * 
 * 【功能】
 * 1. 自動建立根目錄：「我的旅遊足跡紀錄」
 * 2. 依照旅行主題建立專屬資料夾（例如：「2026 歡樂旅遊紀錄」）
 * 3. 同時儲存兩張照片：
 *    - 【版本 B：純淨原圖】（例如：20261126_221530_純淨原圖.jpg）
 *    - 【版本 A：打卡印章圖】（例如：20261126_221530_打卡印章.jpg）
 * 4. 自動建立並更新「旅遊足跡清單.csv」，記錄每一次拍照的詳細地址與 Google 地圖導航連結！
 */

function doPost(e) {
  try {
    // 1. 解析手機網頁端傳過來的 JSON 封包
    var postData = JSON.parse(e.postData.contents);
    var tripTitle = postData.tripTitle || "旅遊生活紀錄";
    var timestamp = postData.timestamp || "未知時間";
    var address = postData.address || "未提供地址";
    var lat = postData.latitude || "";
    var lon = postData.longitude || "";
    var cleanBase64 = postData.cleanImageBase64;
    var stampedBase64 = postData.stampedImageBase64;

    if (!cleanBase64 || !stampedBase64) {
      return ContentService.createTextOutput(JSON.stringify({
        status: "error",
        message: "照片資料不完整，未收到圖片編碼"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 2. 檢查或建立 Google 雲端硬碟資料夾結構
    var rootFolderName = "我的旅遊足跡紀錄";
    var rootFolder = getOrCreateFolder(DriveApp.getRootFolder(), rootFolderName);
    var tripFolder = getOrCreateFolder(rootFolder, tripTitle);
    
    // 依今天日期再細分資料夾（例如：2026-11-26）
    var todayStr = Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd");
    var dateFolder = getOrCreateFolder(tripFolder, todayStr);

    // 3. 檔名時間序號整理
    var fileTimePrefix = Utilities.formatDate(new Date(), "Asia/Taipei", "yyyyMMdd_HHmmss");

    // 4. 解碼並儲存【版本 B：純淨原圖】
    var cleanBlob = Utilities.newBlob(Utilities.base64Decode(cleanBase64), "image/jpeg", fileTimePrefix + "_純淨原圖.jpg");
    var cleanFile = dateFolder.createFile(cleanBlob);

    // 5. 解碼並儲存【版本 A：打卡印章圖】
    var stampedBlob = Utilities.newBlob(Utilities.base64Decode(stampedBase64), "image/jpeg", fileTimePrefix + "_打卡印章.jpg");
    var stampedFile = dateFolder.createFile(stampedBlob);

    // 6. 自動寫入或追加「旅遊足跡紀錄表.csv」
    appendTripLog(dateFolder, fileTimePrefix, timestamp, tripTitle, address, lat, lon, cleanFile.getUrl(), stampedFile.getUrl());

    // 7. 回傳成功狀態給手機網頁端
    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      message: "雙版本照片與行程紀錄已成功存入 Google 雲端硬碟！",
      folderName: dateFolder.getName(),
      cleanUrl: cleanFile.getUrl(),
      stampedUrl: stampedFile.getUrl()
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: "雲端儲存時發生錯誤：" + error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// 輔助函式：取得或建立特定名稱的資料夾
function getOrCreateFolder(parent, folderName) {
  var folders = parent.getFoldersByName(folderName);
  if (folders.hasNext()) {
    return folders.next();
  } else {
    return parent.createFolder(folderName);
  }
}

// 輔助函式：追加寫入旅遊日誌表格
function appendTripLog(folder, fileId, timeStr, title, addr, lat, lon, cleanUrl, stampedUrl) {
  var fileName = "當日旅遊足跡清單.csv";
  var files = folder.getFilesByName(fileName);
  var file;
  var googleMapLink = (lat && lon) ? "https://maps.google.com/?q=" + lat + "," + lon : "無座標";

  var rowText = [
    '"' + fileId + '"',
    '"' + timeStr + '"',
    '"' + title + '"',
    '"' + addr + '"',
    '"' + lat + '"',
    '"' + lon + '"',
    '"' + googleMapLink + '"',
    '"' + cleanUrl + '"',
    '"' + stampedUrl + '"'
  ].join(",") + "\n";

  if (files.hasNext()) {
    file = files.next();
    var existingContent = file.getBlob().getDataAsString("UTF-8");
    file.setContent(existingContent + rowText);
  } else {
    var header = "序號,拍攝時間,旅行主題,繁體中文地址,緯度,經度,Google地圖導航,純淨原圖連結,打卡印章圖連結\n";
    folder.createFile(fileName, "\uFEFF" + header + rowText, MimeType.CSV); // \uFEFF 為 Excel 防亂碼標記
  }
}
