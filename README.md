# MSFS on Proxmox 報告（GitHub Pages 版）

這是一個可透過 GitHub Pages 發佈的 React 單頁應用，內建 Markdown 編輯、匯出與自我檢查功能，內容來自 jason5545 的 MSFS on Proxmox 報告。

## 本地開發

```bash
npm install
npm run dev
```

## 建置靜態檔案

```bash
npm run build
```

會輸出到 `dist/` 目錄，可直接部署到靜態網站伺服器。

## GitHub Pages 發佈

專案已附上 `.github/workflows/deploy.yml`，只要：

1. 將程式碼推送到 GitHub，確保預設分支為 `main`。
2. 在 GitHub Repository 的 **Settings → Pages** 啟用「Build and deployment: GitHub Actions」。
3. 之後每次推送到 `main`，CI 會自動建置並釋出到 GitHub Pages。

如需手動觸發，也可在 GitHub 的 **Actions** 分頁使用 `Run workflow`。
