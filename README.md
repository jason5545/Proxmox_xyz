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

專案已附上 `.github/workflows/deploy.yml` 並在 Vite 設定 `base: "/Proxmox_xyz/"`，確保產生的資源路徑符合 GitHub Pages 子路徑，實際部署網址為 https://jason5545.github.io/Proxmox_xyz/ 。只要：

1. 將程式碼推送到 GitHub，確保預設分支為 `main`。
2. 在 GitHub Repository 的 **Settings → Pages** 啟用「Build and deployment: GitHub Actions」。
3. 之後每次推送到 `main`，CI 會自動建置並釋出到 GitHub Pages。

如需手動觸發，也可在 GitHub 的 **Actions** 分頁使用 `Run workflow`。

## 自訂預設報告內容

應用程式載入時會從 `src/content/initial-report.md` 匯入預設 Markdown。若要換成自己的範本，只要編輯這個檔案，或替換為其他 `.md` 檔並調整 `src/constants/report.js` 中的匯入路徑即可。
