// @ts-nocheck
import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion } from "framer-motion";
import { Download, Moon, SunMedium, FileDown, Clipboard, BugPlay, Calendar, CheckCircle2, AlertCircle, Zap } from "lucide-react";
import { marked } from "marked";

// -----------------------------
// MSFS on Proxmox with GPU Passthrough 技術報告展示頁面
// - 左側 TOC 導覽、右側 Markdown 內容展示
// - 支援深色模式、程式碼區塊一鍵複製、匯出 MD/HTML
// - 現代化玻璃效果設計、響應式布局
// -----------------------------

const STORAGE_KEY = "msfs_report_markdown_v1";
const TITLE_DEFAULT = "從 DXGI 錯誤到 97% 效能 — Proxmox VFIO 終極最佳化實錄（jason5545）";

// 使用陣列 join，避免模板字面值中含有反引號(`)造成語法錯誤
const INITIAL_MD = [
  '# 你的 LowEndTalk 討論整理報告（jason5545）',
  '',
  '> 主題：**MSFS on Proxmox with GPU Passthrough (DXGI HANG) — $100 Bounty**',
  '',
  '---',
  '',
  '## 摘要（TL;DR）',
  '- **原始問題**：在 Proxmox VE 以 VFIO 直通 RTX 4070 Ti Super 給 Windows VM 時，MSFS 2024 載入階段報 **`DXGI_ERROR_DEVICE_HUNG`**；MSFS 2020 先前測過能跑但 FPS 極差。裸機 Windows 下皆正常。',
  '- **最終結論**：',
  '  1) 先解決 **GPU reset / rebind** 穩定性（以 **softdep** 取代過度黑名單、搭配 **hookscript** 做 pre-start/unbind 與 post-stop/rescan/rebind）。',
  '  2) VM 效能主因為 **Ryzen 9950X3D 的非對稱 CCD 排程**：將遊戲執行緒固定到 **V-Cache CCD**（core pinning + NUMA）。',
  '  3) 觸發錯誤的直接因素是 **顯卡超頻**；移除後穩定。`rombar=0` 在本案**非必要**。',
  '',
  '完成後 **GPU 利用率由 ~30% 提升至 ~97%**、VM 啟停穩定。',
  '',
  '---',
  '',
  '## 環境與目標',
  '- **主機板**：ROG STRIX B650‑I  ',
  '- **CPU**：Ryzen 9 9950X3D  ',
  '- **GPU（直通）**：ASUS Dual RTX 4070 Ti Super OC 16G  ',
  '- **記憶體**：96 GB  ',
  '- **Hypervisor**：Proxmox VE 8.4（另含 PVE 9/新核心等後續註記）  ',
  '- **目標**：以 PVE 為主系統，Win11 遊戲 VM 透過 Passthrough 跑 MSFS，取代裸機 Windows。',
  '',
  '---',
  '',
  '## 時間線（重點事件）',
  '- **7/24**：發起懸賞求助，說明 DXGI HANG 與環境細節。',
  '- **8/3**：分享遠端串流顯示輸出：使用 **GLKVM** 取代實體螢幕/HDMI 假負載，便於遠端與 BIOS 存取。',
  '- **8/6**：發佈 lm-sensors 修復報告（`nct6775 force_id=0xd802`）使風扇/溫度監控正常，並做永久化設定。',
  '- **8/9**：發佈 **NUT 延遲關機策略**與管理腳本 `nut-delay-manager.sh`，將「斷電即關」改為「定時延後關」。',
  '- **8/9**：音訊回饋：以 **Apollo**，聲音驅動會自動切到 **Steam Streaming**，實測無爆音。',
  '- **8/10**：貼 **`upsc`** 量測數據（1500VA/900W，當下負載 ~17%），討論鉛酸電池壽命與放電策略。',
  '- **9/25**：新增 **GRUB 參數調整**與 **BIOS ASPM 設定**：在 GRUB 中加入 `pcie_aspm=off` 參數停用 PCIe 主動狀態電源管理，同時在 BIOS 中將 ASPM 設為 OFF，進一步改善 GPU 直通穩定性。',
  '- **9/26**：發佈 **最終整合指南**：從 Host 到 VM 的系統化最佳化與除錯；指出**超頻**為錯誤誘因、完成**核心綁定**與**驅動切換自動化**；GPU 利用率達 ~97%。另補 **`nvidia-drm.modeset=0`** 的說明與步驟。同時確認 BIOS 中 **Resizable BAR 設為 OFF**。',
  '- **9/27 晚間**：新增 **NVIDIA 驅動相關黑名單**最佳化設定，包含 `nvidia_modeset`、`nvidia_uvm`、`nvidia_drm` 等模組黑名單，以確保 VFIO 與 NVIDIA 驅動之間的穩定切換。',
  '- **9/28**：開始進行 **PMDG 777F 長程測試航班**（東京羽田 RJTT → 杜拜 OMDB），驗證系統在高負載長時間運作下的穩定性與效能表現。',
  `- **9/28 長程飛行測試發現**：
  - 在 **PMDG 777F** 長程測試中發現，只要觸發遊戲暫停選單，相對容易觸發 **VFIO reset/restore bar** 問題
  - 已進一步縮小範圍至 **Windows 事件管理器**中的 **NVIDIA TOPPS** 相關錯誤
  - 根據社群回報，此問題可能與 **顯示記憶體管理**有關
  - 經測試確認 **hookscript 並非問題來源**，問題仍在持續追查中
  - **OCCT 穩定性測試**：使用 OCCT 進行 80% 顯示記憶體壓力測試，經過 40 多輪測試後顯示沒有異常，確認顯示記憶體本身穩定
  - **memtest86+ 測試**：系統記憶體測試通過（PASS），確認記憶體穩定性無虞`,
  '- **9/29 進階測試發現與方案驗證**：問題呈現明顯的時間依賴特性，系統穩定運作約一小時後，觸發遊戲暫停選單時才會誘發 VFIO reset/restore bar 錯誤。經 OCCT 混合負載與單獨 3D+VRAM 測試（持續 33 分鐘）皆運作正常，顯示問題僅在特定遊戲場景下觸發，並非純硬體壓力測試可重現。已測試 Windows Registry DisableIdlePowerManagement 與 NVIDIA Profile Inspector 電源管理設定，兩者皆無效，問題依舊。根本原因持續追蹤中。',
  '- **9/30 硬體排查完成**：執行完整 PCIe 診斷，確認硬體層面完全正常：錯誤計數全為 0（DevSta: CorrErr- NonFatalErr- FatalErr-）、連結速度 16GT/s（PCIe 4.0 全速）、寬度 x16、無 AER 錯誤記錄。**100% 排除 PCIe Riser 硬體問題**，確認問題根源為虛擬化軟體層（VFIO 與 NVIDIA TOPPS 相容性）。',
  '- **9/30 重大發現：PCIe 裝置消失現象**：進一步調查發現，問題發生時 **`lspci` 指令完全找不到 GPU 裝置**（01:00.0 從系統中消失）。這表示問題不是單純的驅動錯誤，而是 **GPU 進入 D3cold 深度睡眠後無法喚醒，導致 PCIe link down**。此發現徹底改變問題性質：從軟體相容性問題升級為 **PCIe 電源狀態管理問題**。解決方向調整為：阻止 GPU 進入深度睡眠狀態（disable_idle_d3 + Runtime PM 控制）。',
  '- **9/30 開始測試 disable_idle_d3 方案**：基於 PCIe 裝置消失發現，立即加入 `disable_idle_d3=1` VFIO 模組參數，阻止 GPU 進入 D3cold 深度睡眠狀態。搭配原有的 `pcie_aspm.policy=performance` 與 `kvm.ignore_msrs=1` 設定，開始長程測試驗證。監控重點：lspci 是否還會消失、VFIO reset 是否還會觸發。',
  '',
  '---',
  '',
  '## 🔬 待測試項目（NVIDIA TOPPS 問題）',
  '',
  '> **問題核心**：遊戲暫停選單觸發 VFIO reset/restore bar，源自 NVIDIA TOPPS（電源狀態管理）與虛擬化環境的不相容',
  '',
  '> **🚨 9/30 重大發現**：問題發生時 **GPU 裝置從 `lspci` 完全消失**，表示 GPU 進入 **D3cold 深度睡眠後無法喚醒**，導致 PCIe link down。這不是單純的驅動錯誤，而是 **PCIe 電源狀態管理失效**。',
  '',
  '### 問題分析',
  '- **已排除項目**：',
  '  - ✅ 硬體穩定（OCCT、memtest86+ 通過）',
  '  - ✅ hookscript 正常運作',
  '  - ✅ 顯示記憶體無異常',
  '  - ✅ 基本效能（97% GPU 利用率）',
  '  - ✅ PCIe 硬體（9/30 驗證：錯誤計數 0、16GT/s x16 全速、無 AER 錯誤）',
  '  - ✅ PCIe Riser 硬體問題（100% 排除）',
  '- **核心問題**（9/30 更新）：',
  '  ```',
  '  遊戲暫停 → GPU 電源狀態 P0→P8→D3cold',
  '  → PCIe link down → 裝置從系統消失（lspci 找不到）',
  '  → 無法喚醒 → 需要 PCIe rescan',
  '  ```',
  '',
  '### 待測試解決方案',
  '',
  '#### 方案一：Windows Registry 強制停用 TOPPS',
  '',
  '> **📥 快速下載**：[nvidia-disable-power-management.reg](https://raw.githubusercontent.com/jason5545/Proxmox_xyz/main/nvidia-disable-power-management.reg)',
  '',
  '```reg',
  '[HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000]',
  '"DisableDynamicPstate"=dword:00000001',
  '"PerfLevelSrc"=dword:00003333',
  '```',
  '',
  '**使用步驟**：',
  '1. 下載 .reg 檔案到 Windows VM',
  '2. 雙擊執行，允許權限提示',
  '3. 重新啟動系統',
  '4. 測試是否解決問題',
  '',
  '#### 方案二：阻止 GPU 進入深度睡眠（**9/30 更新：關鍵方案**）',
  '',
  '> **🚨 重要**：基於 9/30 發現（lspci 消失），此方案從「可能有害」升級為「必要方案」',
  '',
  '**Host 端 VFIO 設定**：',
  '```bash',
  '# /etc/modprobe.d/vfio.conf',
  '# 阻止 GPU 進入 D3 深度睡眠狀態',
  'options vfio-pci ids=10de:2705,10de:22bb disable_idle_d3=1 nointxmask=1',
  '```',
  '',
  '**Runtime PM 控制（加入 hookscript）**：',
  '```bash',
  '# 編輯 /var/lib/vz/snippets/gpu-manager.sh',
  '# 在 pre-start 階段加入：',
  'echo on > /sys/bus/pci/devices/0000:01:00.0/power/control',
  'echo on > /sys/bus/pci/devices/0000:01:00.1/power/control',
  '',
  '# 在 post-stop 階段加入：',
  'echo auto > /sys/bus/pci/devices/0000:01:00.0/power/control',
  'echo auto > /sys/bus/pci/devices/0000:01:00.1/power/control',
  '```',
  '',
  '**GRUB 參數強化**：',
  '```bash',
  '# /etc/default/grub 加入更激進的 PCIe 電源管理停用',
  'GRUB_CMDLINE_LINUX_DEFAULT="... pcie_aspm.policy=performance"',
  '```',
  '',
  '#### 方案三：NVIDIA Profile Inspector 設定',
  '',
  '> **下載位置**：GitHub - [Orbmu2k/nvidiaProfileInspector](https://github.com/Orbmu2k/nvidiaProfileInspector/releases)',
  '',
  '**關鍵設定項目**：',
  '- **Power management mode**: `Prefer maximum performance`',
  '- **CUDA - Force P2 State**: `OFF`',
  '- **Thread Optimization**: `OFF`',
  '- **Multi-Display/Mixed-GPU Acceleration**: `Single display performance mode`',
  '',
  '#### 方案四：VM 層級調整',
  '',
  '**Proxmox 設定檔方式**（建議）：',
  '```bash',
  '# /etc/pve/qemu-server/100.conf 新增',
  'args: -cpu host,kvm=off',
  '# 或',
  'args: -machine pc,accel=kvm -cpu host,kvm=off,hv-vendor-id=1234567890ab',
  '```',
  '',
  '**核心層級 MSR 處理**：',
  '```bash',
  '# /etc/modprobe.d/kvm.conf',
  'options kvm ignore_msrs=Y',
  'options kvm report_ignored_msrs=N',
  '',
  '# 核心參數（/etc/default/grub）- 基於現有 ASPM 設定',
  'GRUB_CMDLINE_LINUX_DEFAULT="quiet amd_iommu=on iommu=pt pcie_acs_override=downstream,multifunction pcie_aspm=off nvidia-drm.modeset=0 kvm.ignore_msrs=1"',
  '```',
  '',
  '#### 方案五：Host 端調整（僅適用特殊情況）',
  '```bash',
  '# ⚠️ 注意：由於已設定 NVIDIA 黑名單，Host 端選項有限',
  '',
  '# AMD/Radeon GPU（DRM 介面）- 如果有混合 GPU 配置',
  'echo "high" > /sys/class/drm/card0/device/power_dpm_force_performance_level',
  '',
  '# NVIDIA Host 端方案（需要臨時移除黑名單）',
  '# 由於 TOPPS 問題主要在 VM 內部，且黑名單已提升基礎穩定性',
  '# 建議優先測試前四個 VM 內部解決方案',
  '```',
  '',
  '### 推薦測試順序（**9/30 更新**）',
  '',
  '> **前提**：確保已套用 9/25 基礎設定（BIOS ASPM OFF + GRUB `pcie_aspm=off`）',
  '> **9/30 重大發現**：問題發生時 GPU 從 lspci 消失，表示進入 D3cold 後無法喚醒',
  '> **新策略**：**優先阻止 GPU 進入深度睡眠**，同時搭配 VM 層級調整',
  '',
  '**已測試（無效）**：',
  '1. ~~Windows Registry DisableIdlePowerManagement~~（9/29 測試：無效）',
  '2. ~~NVIDIA Profile Inspector 電源設定~~（9/29 測試：無效）',
  '',
  '**測試中**：',
  '1. ⏳ **方案二：disable_idle_d3=1**（**9/30 已加入，測試中**）',
  '   ```bash',
  '   # 已套用設定：',
  '   ✅ disable_idle_d3=1（VFIO 模組參數）',
  '   ✅ pcie_aspm.policy=performance（GRUB，原有）',
  '   ✅ kvm.ignore_msrs=1（原有）',
  '   ',
  '   # 待觀察：',
  '   - 是否還會觸發 VFIO reset',
  '   - lspci 是否還會消失',
  '   - 長程飛行穩定性',
  '   ```',
  '',
  '**後續計畫**：',
  '1. 如果 disable_idle_d3 有效：問題解決 ✅',
  '2. 如果仍有問題：加入 Runtime PM control（hookscript）',
  '3. 如果還是有問題：測試其他遊戲（3DMark、Cyberpunk 2077）',
  '4. 如果其他遊戲正常：考慮 MSFS 特定設定',
  '',
  '### 監控與診斷',
  '```bash',
  '# 問題發生時收集資訊',
  'dmesg -T | grep -E "vfio|BAR|reset|TOPPS|ASPM" > /tmp/topps_debug.log',
  'cat /proc/interrupts | grep vfio >> /tmp/topps_debug.log',
  'lspci -vvv -s 01:00.0 >> /tmp/topps_debug.log',
  '',
  '# 檢查 ASPM 狀態',
  'cat /sys/module/pcie_aspm/parameters/policy >> /tmp/topps_debug.log',
  'lspci -vvv | grep -i aspm >> /tmp/topps_debug.log',
  '',
  '# Windows 事件檢視器',
  '# 查看：應用程式和服務記錄檔 → Microsoft → Windows → DirectX-DXGI',
  '```',
  '',
  '---',
  '',
  '## 🔍 PCIe 硬體排查指令',
  '',
  '> **何時需要排查**：如果上述 VM 層級方案都無效，需排除 PCIe Riser 或硬體問題',
  '',
  '### 完整診斷指令',
  '',
  '```bash',
  '# 1. 檢查 PCIe 錯誤計數（最重要）',
  'lspci -vvv -s 01:00.0 | grep -E "CorrErr|NonFatalErr|FatalErr|UnsuppReq"',
  '',
  '# 正常輸出應該全是 "-"（disabled）：',
  '# CorrErr- NonFatalErr- FatalErr- UnsuppReq-',
  '# 如果看到 "+" 表示有錯誤發生',
  '',
  '# 2. 檢查 PCIe 連結速度與寬度',
  'lspci -vvv -s 01:00.0 | grep -A5 "LnkCap\\|LnkSta"',
  '',
  '# RTX 4070 Ti Super 應該是：',
  '# LnkCap: Speed 16GT/s, Width x16',
  '# LnkSta: Speed 16GT/s, Width x16',
  '# 如果 LnkSta 降速（如 8GT/s）或降寬（如 x8）→ 可能是 Riser 問題',
  '',
  '# 3. 檢查當前連結狀態（系統檔案）',
  'cat /sys/bus/pci/devices/0000:01:00.0/current_link_speed',
  'cat /sys/bus/pci/devices/0000:01:00.0/current_link_width',
  '',
  '# 應該輸出：',
  '# 16.0 GT/s',
  '# 16',
  '',
  '# 4. 檢查 AER（Advanced Error Reporting）錯誤',
  'dmesg | grep -i "aer.*01:00"',
  'journalctl | grep -i "pcie.*error"',
  '',
  '# 5. 持續監控連結狀態（在遊戲中執行）',
  'watch -n 1 \'lspci -vvv -s 01:00.0 | grep -E "LnkSta|CorrErr"\'',
  '',
  '# 6. 完整 PCIe 資訊匯出',
  'lspci -vvv -s 01:00.0 > /tmp/pcie_full_info.txt',
  'cat /tmp/pcie_full_info.txt',
  '```',
  '',
  '### 判斷標準',
  '',
  '| 檢查項目 | 正常狀態 | 異常狀態 | 結論 |',
  '|---------|---------|---------|------|',
  '| CorrErr/NonFatalErr | 全是 `-` | 出現 `+` 或錯誤計數 > 0 | **Riser 訊號問題** |',
  '| LnkSta 速度 | 16GT/s (PCIe 4.0) | 8GT/s 或更低 | **Riser 接觸不良或降速** |',
  '| LnkSta 寬度 | x16 | x8 或更低 | **Riser 通道異常** |',
  '| AER 錯誤訊息 | 無 | 有錯誤記錄 | **PCIe 硬體問題** |',
  '| 連結狀態穩定性 | 不變 | 頻繁變化 | **Riser 不穩定** |',
  '',
  '### 如果發現 PCIe 異常',
  '',
  '**立即處理步驟**：',
  '',
  '1. **檢查 Riser 連接**',
  '   - 確認兩端接頭牢固',
  '   - 檢查線材有無彎折損傷',
  '   - 清潔接點（使用橡皮擦或酒精）',
  '',
  '2. **測試直插主機板**',
  '   - 移除 Riser，直接插入主機板 PCIe 插槽',
  '   - 如果問題消失 → 確認 Riser 問題',
  '   - 如果問題依舊 → 排除 Riser，繼續追查',
  '',
  '3. **更換 Riser 線材**',
  '   - 使用備用 Riser 測試',
  '   - 建議使用品質較好的 PCIe 4.0 認證線材',
  '',
  '### 為什麼 PCIe Riser 可能性較低？',
  '',
  '**支持「軟體問題」的證據**：',
  '',
  '- ✅ 錯誤訊息是 `VFIO reset/TOPPS`（虛擬化層），不是 PCIe AER 錯誤',
  '- ✅ 觸發時機精準（1 小時後 + 暫停選單），硬體問題不會這麼規律',
  '- ✅ OCCT 高負載測試完全穩定（97% GPU 利用率），PCIe 訊號問題在高頻寬時更明顯',
  '- ✅ 與電源狀態轉換 P0→P8 相關，這是軟體電源管理',
  '',
  '**但仍需排查的原因**：',
  '',
  '- ⚠️ 無裸機測試對照',
  '- ⚠️ 完整診斷需排除所有可能性',
  '- ⚠️ 硬體問題排查成本低（5-10 分鐘）',
  '',
  '---',
  '',
  '## Host（Proxmox）層：IOMMU 與驅動管理',
  '**BIOS 設定**（9/25-9/26 確認）：',
  '',
  '```',
  'Resizable BAR: OFF',
  'ASPM (Active State Power Management): OFF',
  '```',
  '',
  '> **重要說明**：',
  '> - **Resizable BAR**：在 GPU 直通環境下可能導致相容性問題，建議停用以確保 VFIO 和 VM 穩定運作',
  '> - **ASPM**：PCIe 主動狀態電源管理可能與 VFIO 產生衝突，停用後可改善 GPU 直通穩定性',
  '',
  '**GRUB 參數**（9/25 新增 ASPM，啟用 IOMMU/ACS，必要時加上 `nvidia-drm.modeset=0`）：',
  '',
  '```bash',
  '# /etc/default/grub',
  'GRUB_CMDLINE_LINUX_DEFAULT="quiet amd_iommu=on iommu=pt pcie_acs_override=downstream,multifunction pcie_aspm=off nvidia-drm.modeset=0"',
  '# 套用後：',
  'sudo update-grub && sudo reboot',
  '```',
  '',
  '> **9/25 新增**：`pcie_aspm=off` 參數停用 PCIe 主動狀態電源管理，與 BIOS ASPM OFF 設定互相配合，進一步改善 GPU 直通時的穩定性。',
  '',
  '**用 softdep 管控載入順序（取代過度黑名單）**：',
  '',
  '```conf',
  '# /etc/modprobe.d/vfio.conf',
  'options vfio-pci ids=10de:2705,10de:22bb',
  'softdep nvidia pre: vfio-pci',
  'softdep nvidia_drm pre: vfio-pci',
  '',
  '# /etc/modprobe.d/pve-blacklist.conf（保留為注解，避免過度黑名單）',
  '# blacklist nvidiafb',
  '# blacklist nouveau',
  '# blacklist nvidia',
  '# blacklist radeon',
  '# blacklist amdgpu',
  'blacklist snd_hda_codec_hdmi',
  '```',
  '',
  '**9/27 晚間補充：NVIDIA 驅動相關黑名單最佳化**：',
  '',
  '為確保 VFIO 與 NVIDIA 驅動之間的穩定切換，在原有 softdep 設定基礎上，新增以下黑名單項目：',
  '',
  '```conf',
  '# /etc/modprobe.d/nvidia-blacklist.conf',
  '# 黑名單 NVIDIA 相關模組，避免在 VFIO 作業時產生衝突',
  'blacklist nvidia_modeset',
  'blacklist nvidia_uvm',
  'blacklist nvidia_drm',
  'blacklist nvidia',
  '',
  '# 同時確保音訊相關模組不會干擾 GPU 直通',
  'blacklist snd_hda_intel',
  'blacklist snd_hda_codec_hdmi',
  '```',
  '',
  '> **重要說明**：此黑名單設定需搭配前述的 hookscript 機制，讓系統能在 VM 啟動前正確載入 vfio-pci，並在 VM 關閉後重新載入 NVIDIA 驅動。',
  '',
  '> 變更後務必 `update-initramfs -u` 並重開機。',
  '',
  '---',
  '',
  '## 驅動接力自動化（Hookscript：解決 GPU Reset Bug）',
  '**概念**：',
  '- **pre-start**：對目標 GPU functions（視訊/音訊）設定 `driver_override=vfio-pci`；若當下已綁其他驅動則先 `unbind`；最後 `modprobe vfio-pci`。',
  '- **post-stop**：清空 `driver_override`、如仍綁 vfio-pci 則 `unbind`，最後 **`echo 1 > /sys/bus/pci/rescan`** 觸發 PCI bus 重掃，讓主機驅動（nvidia）重新認領。',
  '',
  '**掛載方式**：',
  '',
  '```bash',
  '# 儲存腳本',
  '/var/lib/vz/snippets/gpu-manager.sh',
  'chmod +x /var/lib/vz/snippets/gpu-manager.sh',
  '',
  '# 套用到 VM（以 100 為例）',
  'qm set 100 --hookscript local:snippets/gpu-manager.sh',
  '```',
  '',
  '> 此流程是解決 **VM 關機後無法再次啟動（pci_irq_handler Assertion）** 的關鍵。',
  '',
  '---',
  '',
  '## VM 層（效能）：9950X3D V‑Cache 親和性與 I/O',
  '**CPU Core Pinning ＆ NUMA**：',
  '',
  '```conf',
  '# /etc/pve/qemu-server/100.conf（節錄）',
  'affinity: 2-7,18-23',
  'numa: 1',
  'cores: 12',
  'cpu: host,hidden=1',
  '```',
  '',
  '- 以 `lscpu -e` 與 cache 檔案判定 **V-Cache CCD** 實體核心落點，將 VM 12 核 **固定在 V‑Cache CCD**（保留 0/1 + SMT 給 Host 中斷/I/O）。',
  '- 記憶體：建議關閉 balloon、使用 2MB hugepages；',
  '- 磁碟：VirtIO 開 `discard=on` 與 `iothread=1`。',
  '',
  '**超頻設定與穩定性**：',
  '- 初期問題：過度超頻導致 DXGI_ERROR_DEVICE_HUNG 錯誤',
  '- **目前穩定參數**：Core +110 MHz (使用 VF TUNER)、Memory +400 MHz',
  '- 調整方式：漸進式降低超頻幅度，直到系統穩定運作',
  '- **`rombar=0` 結論**：實測真正錯誤誘因是超頻過度，調整後不須 `rombar=0` 亦穩定',
  '- 除錯順序：**先** 檢查超頻/溫度/驅動版本/外掛，**後** 再考慮 `rombar=0` 等低階繞法。',
  '',
  '---',
  '',
  '## 周邊可靠性與維運',
  '- **GLKVM**：作為遠端「螢幕存在」來源，遠端遊玩（Sunshine/Moonlight）不必插實體螢幕，也保留進 BIOS 能力。',
  '- **lm-sensors 修復**：`nct6775 force_id=0xd802` 讓風扇/溫度監控如常。',
  '- **NUT 延遲關機**：以腳本實作延遲邏輯，避免短暫市電異常導致過度關閉。',
  '- **音訊實務**：以 Apollo 讓聲音驅動自動切到 **Steam Streaming**，避免爆音。',
  '- **UPS 能力與負載**：1500VA/實功 900W；當下負載 ~17%；採取淺循環、提早關機閾值以延壽。',
  '',
  '---',
  '',
  '## 黃金範本（檔案片段）',
  '**BIOS 設定**：確保基礎硬體相容性。',
  '',
  '```',
  'Resizable BAR: OFF',
  'ASPM (Active State Power Management): OFF',
  'IOMMU: Enable',
  'VT-d / AMD-Vi: Enable',
  '```',
  '',
  '**`/etc/default/grub`**：IOMMU/ACS、ASPM 停用與（可選）`nvidia-drm.modeset=0`。',
  '',
  '```bash',
  'GRUB_CMDLINE_LINUX_DEFAULT="quiet amd_iommu=on iommu=pt pcie_acs_override=downstream,multifunction pcie_aspm=off nvidia-drm.modeset=0"',
  'update-grub && reboot',
  '```',
  '',
  '**`/etc/modprobe.d/vfio.conf` 與相關驅動設定**：softdep 與精準黑名單。',
  '',
  '```conf',
  '# /etc/modprobe.d/vfio.conf',
  'options vfio-pci ids=10de:2705,10de:22bb',
  'softdep nvidia pre: vfio-pci',
  'softdep nvidia_drm pre: vfio-pci',
  '',
  '# /etc/modprobe.d/nvidia-blacklist.conf（9/27 晚間新增）',
  'blacklist nvidia_modeset',
  'blacklist nvidia_uvm',
  'blacklist nvidia_drm',
  'blacklist nvidia',
  'blacklist snd_hda_intel',
  'blacklist snd_hda_codec_hdmi',
  '```',
  '',
  '**`/var/lib/vz/snippets/gpu-manager.sh`**：pre-start / post-stop 接力。',
  '',
  '```bash',
  '#!/usr/bin/env bash',
  '# 依你的 PCI 位址調整以下變數',
  'dev_video="0000:01:00.0"',
  'dev_audio="0000:01:00.1"',
  '',
  'case "$1" in',
  '  pre-start)',
  '    for d in "$dev_video" "$dev_audio"; do',
  '      echo vfio-pci | sudo tee /sys/bus/pci/devices/$d/driver_override >/dev/null',
  '      if [ -e /sys/bus/pci/devices/$d/driver ]; then',
  '        echo $d | sudo tee /sys/bus/pci/devices/$d/driver/unbind >/dev/null',
  '      fi',
  '    done',
  '    sudo modprobe vfio-pci',
  '    ;;',
  '  post-stop)',
  '    for d in "$dev_video" "$dev_audio"; do',
  '      if [ -e /sys/bus/pci/devices/$d/driver ]; then',
  '        echo $d | sudo tee /sys/bus/pci/devices/$d/driver/unbind >/dev/null',
  '      fi',
  '      echo "" | sudo tee /sys/bus/pci/devices/$d/driver_override >/dev/null',
  '    done',
  '    echo 1 | sudo tee /sys/bus/pci/rescan >/dev/null',
  '    ;;',
  '  *) ;;',
  'esac',
  '```',
  '',
  '**`/etc/pve/qemu-server/100.conf`**（CPU 親和、NUMA、Hugepages、VirtIO I/O）：',
  '',
  '```conf',
  'affinity: 2-7,18-23',
  'numa: 1',
  'cores: 12',
  'cpu: host,hidden=1',
  'memory: 32768',
  'balloon: 0',
  'hugepages: 2',
  'scsi0: local-lvm:vm-100-disk-0,discard=on,iothread=1',
  '```',
  '',
  '---',
  '',
  '## 成果與建議',
  '- **成果**：完成 VM 啟停穩定（解決 pci_irq_handler 相關錯誤），**GPU 利用率 ~97%**，體感接近裸機。',
  '- **長程穩定性驗證**：',
  '  - **9/28 測試航班**：PMDG 777F（東京羽田 RJTT → 杜拜 OMDB），航程約 9 小時',
  '  - **測試目的**：驗證系統在高負載、長時間運作下的穩定性',
  '  - **當前顯示卡設定**：Core +110 MHz (VF TUNER)、Memory +400 MHz',
  '  - **監控重點**：GPU 溫度、記憶體使用率、VM 效能表現、無異常中斷',
  '- **建議**：',
  '  1) 核心/PVE 升級後，檢查 `vfio`/`modprobe` 與 **hookscript** 邏輯是否仍適用；',
  '  2) 若再遇 DXGI/HANG 類問題，先回溯 **顯卡驅動版、超頻/溫度、遊戲內外掛** 等高階因子，再考慮 `rombar=0` 等低階繞法；',
  '  3) 持續以 **lm-sensors**、**NUT**、**UPS** 監控運維，維持長期穩定；',
  '  4) 定期進行長程測試航班，確保系統在真實使用情境下的可靠性。',
].join('\n');

// 時間線事件數據
const TIMELINE_EVENTS = [
  {
    date: '7/24',
    title: '發起懸賞求助',
    content: '說明 DXGI HANG 與環境細節。',
    type: 'milestone',
    icon: AlertCircle
  },
  {
    date: '8/3',
    title: '遠端串流顯示輸出',
    content: '使用 GLKVM 取代實體螢幕/HDMI 假負載，便於遠端與 BIOS 存取。',
    type: 'feature',
    icon: Zap
  },
  {
    date: '8/6',
    title: 'lm-sensors 修復',
    content: '發佈 lm-sensors 修復報告（nct6775 force_id=0xd802）使風扇/溫度監控正常，並做永久化設定。',
    type: 'fix',
    icon: CheckCircle2
  },
  {
    date: '8/9',
    title: 'NUT 延遲關機策略',
    content: '發佈 NUT 延遲關機策略與管理腳本 nut-delay-manager.sh，將「斷電即關」改為「定時延後關」。',
    type: 'feature',
    icon: Zap
  },
  {
    date: '8/9',
    title: '音訊回饋',
    content: '以 Apollo，聲音驅動會自動切到 Steam Streaming，實測無爆音。',
    type: 'test',
    icon: CheckCircle2
  },
  {
    date: '8/10',
    title: 'UPS 量測數據',
    content: '貼 upsc 量測數據（1500VA/900W，當下負載 ~17%），討論鉛酸電池壽命與放電策略。',
    type: 'test',
    icon: Calendar
  },
  {
    date: '9/25',
    title: 'GRUB 與 BIOS ASPM 設定',
    content: '新增 GRUB 參數調整與 BIOS ASPM 設定：在 GRUB 中加入 pcie_aspm=off 參數停用 PCIe 主動狀態電源管理，同時在 BIOS 中將 ASPM 設為 OFF，進一步改善 GPU 直通穩定性。',
    type: 'feature',
    icon: Zap
  },
  {
    date: '9/26',
    title: '最終整合指南',
    content: '發佈最終整合指南：從 Host 到 VM 的系統化最佳化與除錯；指出超頻為錯誤誘因、完成核心綁定與驅動切換自動化；GPU 利用率達 ~97%。另補 nvidia-drm.modeset=0 的說明與步驟。同時確認 BIOS 中 Resizable BAR 設為 OFF。',
    type: 'milestone',
    icon: CheckCircle2
  },
  {
    date: '9/27 晚間',
    title: 'NVIDIA 驅動黑名單最佳化',
    content: '新增 NVIDIA 驅動相關黑名單最佳化設定，包含 nvidia_modeset、nvidia_uvm、nvidia_drm 等模組黑名單，以確保 VFIO 與 NVIDIA 驅動之間的穩定切換。',
    type: 'feature',
    icon: Zap
  },
  {
    date: '9/28',
    title: '長程測試航班',
    content: '開始進行 PMDG 777F 長程測試航班（東京羽田 RJTT → 杜拜 OMDB），驗證系統在高負載長時間運作下的穩定性與效能表現。',
    type: 'test',
    icon: Calendar
  },
  {
    date: '9/28',
    title: '長程飛行測試發現',
    content: '在 PMDG 777F 長程測試中發現，只要觸發遊戲暫停選單，相對容易觸發 VFIO reset/restore bar 問題。',
    details: [
      '已進一步縮小範圍至 Windows 事件管理器中的 NVIDIA TOPPS 相關錯誤',
      '根據社群回報，此問題可能與顯示記憶體管理有關',
      '經測試確認 hookscript 並非問題來源，問題仍在持續追查中',
      'OCCT 穩定性測試：使用 OCCT 進行 80% 顯示記憶體壓力測試，經過 40 多輪測試後顯示沒有異常，確認顯示記憶體本身穩定',
      'memtest86+ 測試：系統記憶體測試通過（PASS），確認記憶體穩定性無虞'
    ],
    type: 'issue',
    icon: AlertCircle
  },
  {
    date: '9/29',
    title: '進階測試發現與方案驗證',
    content: '問題呈現明顯的時間依賴特性，系統穩定運作約一小時後，觸發遊戲暫停選單時才會誘發 VFIO reset/restore bar 錯誤。',
    details: [
      'OCCT 混合負載測試：運作正常',
      'OCCT 單獨 3D+VRAM 測試：持續 33 分鐘運作正常',
      '初步結論：問題僅在特定遊戲場景下觸發，並非純硬體壓力測試可重現',
      '可能涉及遊戲引擎特定的 DirectX 呼叫模式或渲染管線狀態轉換',
      '❌ 測試 Windows Registry DisableIdlePowerManagement：無效',
      '❌ 測試 NVIDIA Profile Inspector 電源管理設定：無效',
      '根本原因持續追蹤中'
    ],
    type: 'issue',
    icon: AlertCircle
  },
  {
    date: '9/30',
    title: 'PCIe 硬體排查完成',
    content: '執行完整 PCIe 診斷，確認硬體層面完全正常。',
    details: [
      '✅ PCIe 錯誤計數：全為 0（DevSta: CorrErr- NonFatalErr- FatalErr- UnsupReq-）',
      '✅ 連結速度：16GT/s（PCIe 4.0 全速）',
      '✅ 連結寬度：x16（滿寬度）',
      '✅ AER 錯誤記錄：無異常',
      '結論：100% 排除 PCIe Riser 硬體問題',
      '確認問題根源為虛擬化軟體層（VFIO 與 NVIDIA TOPPS 相容性）',
      '下一步：測試 VM 層級調整（KVM hidden + MSR ignore）'
    ],
    type: 'fix',
    icon: CheckCircle2
  },
  {
    date: '9/30',
    title: '🚨 重大發現：PCIe 裝置消失現象',
    content: '問題發生時 GPU 裝置從 lspci 完全消失，徹底改變問題性質。',
    details: [
      '🔍 關鍵發現：lspci 指令找不到 01:00.0 GPU 裝置',
      '分析結論：GPU 進入 D3cold 深度睡眠後無法喚醒',
      '結果：PCIe link down → 裝置從系統中完全消失',
      '問題性質：從「軟體相容性」升級為「PCIe 電源狀態管理失效」',
      '解決方向調整：阻止 GPU 進入深度睡眠（disable_idle_d3 + Runtime PM）',
      '排除疑慮：不是 VRAM 故障（OCCT 測試通過、錯誤訊息不符合記憶體問題特徵）',
      '立即行動：加入 disable_idle_d3=1，開始測試'
    ],
    type: 'milestone',
    icon: AlertCircle
  },
  {
    date: '9/30',
    title: '開始測試 disable_idle_d3 方案',
    content: '基於 PCIe 裝置消失發現，加入 disable_idle_d3=1 參數，阻止 GPU 進入深度睡眠。',
    details: [
      '已套用：disable_idle_d3=1（VFIO 模組參數）',
      '已確認：pcie_aspm.policy=performance（原有設定）',
      '已確認：kvm.ignore_msrs=1（原有設定）',
      '測試目標：驗證是否能阻止 GPU 進入 D3cold 狀態',
      '監控重點：lspci 是否還會消失、VFIO reset 是否還會觸發',
      '測試計畫：長程飛行測試（1.5+ 小時），頻繁暫停選單'
    ],
    type: 'test',
    icon: Calendar
  },
];

// Timeline 組件
const Timeline = React.memo(function Timeline({ events }) {
  const typeColors = {
    milestone: 'from-purple-500 to-pink-500',
    feature: 'from-blue-500 to-cyan-500',
    fix: 'from-green-500 to-emerald-500',
    test: 'from-yellow-500 to-orange-500',
    issue: 'from-red-500 to-orange-500'
  };

  const typeBgColors = {
    milestone: 'bg-purple-500/10 dark:bg-purple-500/20 border-purple-500/30',
    feature: 'bg-blue-500/10 dark:bg-blue-500/20 border-blue-500/30',
    fix: 'bg-green-500/10 dark:bg-green-500/20 border-green-500/30',
    test: 'bg-yellow-500/10 dark:bg-yellow-500/20 border-yellow-500/30',
    issue: 'bg-red-500/10 dark:bg-red-500/20 border-red-500/30'
  };

  return (
    <div className="relative py-6">
      {/* 垂直時間線 */}
      <div className="absolute left-6 md:left-8 top-0 bottom-0 w-0.5 bg-gradient-to-b from-blue-500/50 via-purple-500/50 to-pink-500/50" />

      {events.map((event, index) => {
        const Icon = event.icon || Calendar;
        const gradientColor = typeColors[event.type] || typeColors.milestone;
        const bgColor = typeBgColors[event.type] || typeBgColors.milestone;

        return (
          <motion.div
            key={`${event.date}-${index}`}
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{
              duration: 0.5,
              delay: index * 0.05,
              ease: [0.22, 1, 0.36, 1]
            }}
            className="relative pl-16 md:pl-20 pb-10 last:pb-0 group"
          >
            {/* 時間線圓點與圖標 */}
            <motion.div
              initial={{ scale: 0 }}
              whileInView={{ scale: 1 }}
              viewport={{ once: true }}
              transition={{
                duration: 0.4,
                delay: index * 0.05 + 0.2,
                type: "spring",
                stiffness: 200
              }}
              className="absolute left-3 md:left-5 top-2"
            >
              <div className={`relative w-6 h-6 md:w-8 md:h-8 rounded-full bg-gradient-to-br ${gradientColor} p-1 shadow-lg group-hover:shadow-xl transition-shadow duration-300`}>
                <div className="w-full h-full rounded-full bg-white dark:bg-gray-900 flex items-center justify-center">
                  <Icon className={`w-3 h-3 md:w-4 md:h-4 bg-gradient-to-br ${gradientColor} bg-clip-text text-transparent`} style={{ WebkitTextFillColor: 'transparent' }} />
                </div>
              </div>
              {/* 光暈效果 */}
              <div className={`absolute inset-0 rounded-full bg-gradient-to-br ${gradientColor} opacity-20 blur-sm group-hover:opacity-40 transition-opacity duration-300`} />
            </motion.div>

            {/* 內容卡片 */}
            <motion.div
              whileHover={{ y: -2 }}
              className={`rounded-2xl ${bgColor} border backdrop-blur-sm p-5 md:p-6 shadow-lg hover:shadow-xl transition-all duration-300`}
            >
              {/* 日期標籤 */}
              <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gradient-to-r ${gradientColor} text-white text-xs md:text-sm font-bold mb-3 shadow-md`}>
                <Calendar className="w-3 h-3 md:w-4 md:h-4" />
                {event.date}
              </div>

              {/* 標題 */}
              <h3 className="text-lg md:text-xl font-bold text-gray-800 dark:text-gray-100 mb-2">
                {event.title}
              </h3>

              {/* 內容 */}
              <p className="text-sm md:text-base text-gray-700 dark:text-gray-300 leading-relaxed">
                {event.content}
              </p>

              {/* 詳細資訊（如果有） */}
              {event.details && event.details.length > 0 && (
                <motion.ul
                  initial={{ opacity: 0, height: 0 }}
                  whileInView={{ opacity: 1, height: 'auto' }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.2 }}
                  className="mt-4 space-y-2 border-t border-gray-200 dark:border-gray-700 pt-4"
                >
                  {event.details.map((detail, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
                      <span className="text-blue-500 mt-1">•</span>
                      <span>{detail}</span>
                    </li>
                  ))}
                </motion.ul>
              )}
            </motion.div>
          </motion.div>
        );
      })}
    </div>
  );
});

function useLocalStorage(key, initial) {
  const [state, setState] = useState(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(key) : null;
    return saved ?? initial;
  });
  useEffect(() => {
    if (typeof window !== 'undefined') localStorage.setItem(key, state);
  }, [key, state]);
  return [state, setState];
}

// 遞迴提取 ReactMarkdown children 的純文字內容
function extractTextFromChildren(children) {
  if (typeof children === 'string') {
    return children;
  }

  if (Array.isArray(children)) {
    return children.map(extractTextFromChildren).join('');
  }

  if (children && typeof children === 'object') {
    if (children.props && children.props.children) {
      return extractTextFromChildren(children.props.children);
    }
    if (children.props && typeof children.props.value === 'string') {
      return children.props.value;
    }
  }

  return '';
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-z0-9\s\-]/g, "") // 移除括號和其他特殊字元
    .trim()
    .replace(/\s+/g, "-") // 將空格轉為連字號
    .replace(/^-+|-+$/g, ""); // 移除開頭和結尾的連字號
}

// 增強的 TOC 提取函數，支援更多 Markdown 格式
function extractTocAdvanced(md) {
  if (!md || typeof md !== 'string') return [];

  const lines = md.split('\n');
  const items = [];
  let inCodeBlock = false;
  let codeBlockFence = '';
  let inHtmlBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    // 處理程式碼區塊（支援 ```, ~~~, 和縮排程式碼）
    if (!inCodeBlock && (line.startsWith('```') || line.startsWith('~~~'))) {
      inCodeBlock = true;
      codeBlockFence = line.slice(0, 3);
      continue;
    }

    if (inCodeBlock && line.startsWith(codeBlockFence)) {
      inCodeBlock = false;
      codeBlockFence = '';
      continue;
    }

    // 跳過程式碼區塊和縮排程式碼區塊
    if (inCodeBlock || rawLine.startsWith('    ') || rawLine.startsWith('\t')) {
      continue;
    }

    // 處理 HTML 標題標籤
    const htmlHeadingMatch = line.match(/^<(h[1-6])(?:\s[^>]*)?>(.+?)<\/h[1-6]>/i);
    if (htmlHeadingMatch) {
      const level = parseInt(htmlHeadingMatch[1].charAt(1));
      if (level <= 4) {
        const title = htmlHeadingMatch[2].replace(/<[^>]*>/g, '').replace(/`/g, '').trim();
        if (title) {
          const id = slugify(title);
          items.push({ depth: level, title, id, line: i + 1 });
        }
      }
      continue;
    }

    // 處理 Markdown 標題（#）
    const markdownMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (markdownMatch) {
      const depth = markdownMatch[1].length;
      if (depth <= 4) {
        // 清理標題文字：移除內嵌程式碼、連結、粗體等標記
        let title = markdownMatch[2]
          .replace(/`([^`]+)`/g, '$1')  // 移除內嵌程式碼標記
          .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')  // 移除連結，保留文字
          .replace(/\*\*([^*]+)\*\*/g, '$1')  // 移除粗體標記
          .replace(/\*([^*]+)\*/g, '$1')  // 移除斜體標記
          .replace(/~~([^~]+)~~/g, '$1')  // 移除刪除線標記
          .trim();

        if (title) {
          const id = slugify(title);
          items.push({ depth, title, id, line: i + 1 });
        }
      }
      continue;
    }

    // 處理 Setext 標題（底線式）
    if (i < lines.length - 1) {
      const nextLine = lines[i + 1].trim();
      if (line && (nextLine.match(/^=+$/) || nextLine.match(/^-+$/))) {
        const depth = nextLine.startsWith('=') ? 1 : 2;
        if (depth <= 4) {
          let title = line
            .replace(/`([^`]+)`/g, '$1')
            .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
            .replace(/\*\*([^*]+)\*\*/g, '$1')
            .replace(/\*([^*]+)\*/g, '$1')
            .trim();

          if (title) {
            const id = slugify(title);
            items.push({ depth, title, id, line: i + 1 });
          }
        }
        i++; // 跳過底線
        continue;
      }
    }
  }

  return items;
}

// 相容性：保持原函數名稱，暫時使用簡單版本
function extractToc(md) {
  if (!md || typeof md !== 'string') return [];

  const lines = md.split("\n");
  const items = [];
  let inCodeBlock = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("```") || line.startsWith("~~~")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    const m = /^(#{1,4})\s+(.+)$/.exec(line);
    if (m) {
      const depth = m[1].length; // 1..4
      const title = m[2].replace(/`/g, "");
      const id = slugify(title);
      items.push({ depth, title, id });
    }
  }
  return items;
}

// useToc hook：分離 TOC 邏輯和狀態管理
function useToc(markdown) {
  const toc = useMemo(() => {
    try {
      return extractToc(markdown); // 使用簡單穩定的版本
    } catch (error) {
      console.warn('TOC 提取失敗:', error);
      return [];
    }
  }, [markdown]);

  const scrollToElement = useCallback((id, options = {}) => {
    try {
      const element = document.getElementById(id);
      if (element) {
        element.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
          ...options
        });
        return true;
      }
      return false;
    } catch (error) {
      console.warn('滾動到元素失敗:', error);
      return false;
    }
  }, []);

  return { toc, scrollToElement };
}

// useActiveSection hook：追蹤可視區域中的活動標題
function useActiveSection(toc) {
  const [activeId, setActiveId] = useState('');
  const observerRef = useRef(null);

  useEffect(() => {
    if (!toc || toc.length === 0) {
      setActiveId('');
      return;
    }

    // 延遲執行，確保 DOM 已渲染
    const timeoutId = setTimeout(() => {
      // 清理之前的 observer
      if (observerRef.current) {
        observerRef.current.disconnect();
      }

      // 建立新的 Intersection Observer
      const observerOptions = {
        root: null,
        rootMargin: '-20% 0px -70% 0px',
        threshold: [0, 0.25, 0.5, 0.75, 1]
      };

      const observer = new IntersectionObserver((entries) => {
        const visibleEntries = entries.filter(entry => entry.isIntersecting);

        if (visibleEntries.length > 0) {
          const topEntry = visibleEntries.reduce((top, entry) => {
            return entry.boundingClientRect.top < top.boundingClientRect.top ? entry : top;
          });

          setActiveId(topEntry.target.id);
        }
      }, observerOptions);

      observerRef.current = observer;

      // 觀察所有標題元素
      const headingElements = toc.map(item => document.getElementById(item.id)).filter(Boolean);

      if (headingElements.length > 0) {
        headingElements.forEach(el => observer.observe(el));

        // 初始設定
        const currentVisible = headingElements.find(el => {
          const rect = el.getBoundingClientRect();
          return rect.top >= 0 && rect.top <= window.innerHeight * 0.3;
        });

        if (currentVisible) {
          setActiveId(currentVisible.id);
        } else {
          setActiveId(headingElements[0].id);
        }
      }
    }, 100); // 延遲 100ms 確保 DOM 渲染完成

    return () => {
      clearTimeout(timeoutId);
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [toc]);

  return activeId;
}

// TOC 樣式系統：統一管理層級樣式
const tocStyles = {
  // 基本容器樣式
  container: {
    base: "rounded-2xl bg-white/60 dark:bg-gray-900/60 backdrop-blur-md border border-neutral-200/50 dark:border-neutral-800/50 p-5 shadow-xl dark:shadow-gray-900/50",
    sticky: "lg:sticky lg:top-[64px] h-max"
  },

  // 標題樣式
  header: "text-sm font-bold tracking-wide uppercase text-gray-600 dark:text-gray-400",

  // 導航容器樣式
  nav: "space-y-1 text-sm max-h-[60vh] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-700",

  // 項目基礎樣式
  item: {
    base: "w-full text-left block truncate py-1 px-2 rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50",
    hover: "hover:bg-blue-50 dark:hover:bg-blue-900/30",
    active: "bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300",
    inactive: ""
  },

  // 層級特定樣式
  depth: {
    1: {
      text: "font-bold text-gray-800 dark:text-gray-100",
      padding: "",
      prefix: ""
    },
    2: {
      text: "text-gray-700 dark:text-gray-300",
      padding: "pl-4",
      prefix: "›"
    },
    3: {
      text: "text-gray-600 dark:text-gray-400",
      padding: "pl-6",
      prefix: "››"
    },
    4: {
      text: "text-gray-500 dark:text-gray-500",
      padding: "pl-8",
      prefix: "›››"
    }
  }
};

// 生成項目樣式的輔助函數
function getTocItemClasses(depth, isActive) {
  const baseClasses = `${tocStyles.item.base} ${tocStyles.item.hover}`;
  const stateClasses = isActive ? tocStyles.item.active : tocStyles.item.inactive;
  const depthClasses = tocStyles.depth[depth] ?
    `${tocStyles.depth[depth].text} ${tocStyles.depth[depth].padding}` :
    tocStyles.depth[4].text;

  return `${baseClasses} ${stateClasses} ${depthClasses}`.trim();
}

// TocItem 元件：封裝單一目錄項目的邏輯和可存取性
const TocItem = React.memo(function TocItem({
  item,
  isActive,
  onNavigate,
  index,
  totalItems
}) {
  const handleClick = useCallback((e) => {
    e.preventDefault();
    if (onNavigate) {
      const success = onNavigate(item.id);
      if (!success) {
        console.warn(`無法導航到標題: ${item.title} (${item.id})`);
      }
    }
  }, [item.id, item.title, onNavigate]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick(e);
    }
  }, [handleClick]);

  const depthStyle = tocStyles.depth[item.depth] || tocStyles.depth[4];
  const prefix = depthStyle.prefix;

  return (
    <button
      type="button"
      className={getTocItemClasses(item.depth, isActive)}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      aria-current={isActive ? 'location' : undefined}
      aria-label={`導航到 ${item.title}${item.line ? `，第 ${item.line} 行` : ''}`}
      title={`點選跳轉到: ${item.title}`}
      role="link"
      tabIndex={0}
      data-toc-index={index}
      data-toc-depth={item.depth}
      data-toc-id={item.id}
    >
      <span className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
        {prefix && (
          <span className="opacity-40 mr-1" aria-hidden="true">
            {prefix}
          </span>
        )}
        <span className={isActive ? 'font-medium' : ''}>{item.title}</span>
      </span>
    </button>
  );
});

// TocContainer 元件：完整的 TOC 容器，整合所有功能
const TocContainer = React.memo(function TocContainer({
  markdown,
  className = '',
  showPrintButton = true,
  maxHeight = '60vh',
  title = '目錄'
}) {
  const { toc, scrollToElement } = useToc(markdown);
  const activeId = useActiveSection(toc);
  const [error, setError] = useState(null);

  // 錯誤邊界處理
  useEffect(() => {
    if (!markdown) {
      setError('無 Markdown 內容');
      return;
    }
    // 只有在 markdown 存在但 TOC 為空時才視為錯誤
    if (markdown && toc.length === 0) {
      // 延遲檢查，給 TOC 提取時間
      const timeoutId = setTimeout(() => {
        if (toc.length === 0) {
          setError('未找到標題');
        }
      }, 200);
      return () => clearTimeout(timeoutId);
    }
    setError(null);
  }, [markdown, toc]);

  const handleNavigate = useCallback((id) => {
    try {
      return scrollToElement(id);
    } catch (error) {
      console.error('導航錯誤:', error);
      setError('導航失敗');
      return false;
    }
  }, [scrollToElement]);

  const handlePrint = useCallback(() => {
    try {
      window.print();
    } catch (error) {
      console.error('列印錯誤:', error);
      alert('列印功能不可用');
    }
  }, []);

  // 鍵盤導航支援
  const handleContainerKeyDown = useCallback((e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();

      const buttons = Array.from(e.currentTarget.querySelectorAll('button[data-toc-index]'));
      const currentIndex = buttons.findIndex(btn => btn === document.activeElement);

      let nextIndex;
      if (e.key === 'ArrowDown') {
        nextIndex = currentIndex < buttons.length - 1 ? currentIndex + 1 : 0;
      } else {
        nextIndex = currentIndex > 0 ? currentIndex - 1 : buttons.length - 1;
      }

      if (buttons[nextIndex]) {
        buttons[nextIndex].focus();
      }
    }
  }, []);

  if (!toc || toc.length === 0) {
    return (
      <aside className={`${tocStyles.container.sticky} ${className}`}>
        <div className={tocStyles.container.base}>
          <div className="flex items-center justify-between mb-3">
            <h2 className={tocStyles.header}>{title}</h2>
          </div>
          <div className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
            {error || '載入中...'}
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className={`${tocStyles.container.sticky} ${className}`}>
      <div className={tocStyles.container.base}>
        <div className="flex items-center justify-between mb-3">
          <h2 className={tocStyles.header}>{title}</h2>
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {toc.length} 項
          </span>
        </div>

        <nav
          className={tocStyles.nav}
          style={{ maxHeight }}
          onKeyDown={handleContainerKeyDown}
          role="navigation"
          aria-label="文件目錄導航"
        >
          {toc.map((item, index) => (
            <TocItem
              key={`${item.id}-${index}`}
              item={item}
              isActive={activeId === item.id}
              onNavigate={handleNavigate}
              index={index}
              totalItems={toc.length}
            />
          ))}
        </nav>

        {showPrintButton && (
          <>
            <hr className="my-3 border-neutral-200 dark:border-neutral-800"/>
            <div className="flex justify-center">
              <button
                onClick={handlePrint}
                className="inline-flex items-center gap-2 rounded-xl bg-white/50 dark:bg-gray-800/50 backdrop-blur border border-neutral-300/50 dark:border-neutral-700/50 px-3 py-1.5 text-xs hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-all"
                title="列印或匯出 PDF"
                aria-label="列印或匯出 PDF"
              >
                列印 / PDF
              </button>
            </div>
          </>
        )}
      </div>
    </aside>
  );
});

function CodeBlock({children}) {
  const text = String(children);
  const [copied, setCopied] = useState(false);

  return (
    <div className="group relative">
      <pre className="rounded-2xl border border-gray-200/50 dark:border-gray-700/50 p-5 overflow-x-auto text-sm bg-gradient-to-br from-gray-50 to-gray-100/50 dark:from-gray-900/50 dark:to-gray-800/30 text-gray-800 dark:text-gray-200 shadow-lg dark:shadow-gray-900/50 backdrop-blur-sm">
        <code className="font-mono">{text}</code>
      </pre>
      <button
        onClick={() => {
          navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          });
        }}
        className={`absolute top-3 right-3 flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-all backdrop-blur-md ${
          copied
            ? "bg-green-500/90 text-white border border-green-400/50"
            : "bg-white/80 dark:bg-gray-800/80 border border-gray-300/50 dark:border-gray-600/50 opacity-0 group-hover:opacity-100"
        }`}
        title={copied ? "已複製" : "複製程式碼"}
      >
        <Clipboard size={14} className={copied ? "animate-bounce" : ""} />
        {copied ? "已複製!" : "複製"}
      </button>
    </div>
  );
}

// --- 簡易自測（"測試案例"）---
function runSelfTests() {
  const results = [];
  const push = (name, pass, extra = "") => results.push({ name, pass, extra });
  try {
    push("slugify basic", slugify("Hello World") === "hello-world");
    push("slugify 中文+英數", slugify("測試 Test 123") === "測試-test-123");
    push("slugify 括號處理", slugify("時間線（重點事件）") === "時間線重點事件");
    const toc = extractToc(["# A", "", "## B", "### C"].join("\n"));
    push("extractToc length", toc.length === 3, JSON.stringify(toc));
    const tocWithCode = extractToc(["```", "# not heading", "```", "## Real"].join("\n"));
    push("extractToc ignore code fences", tocWithCode.length === 1 && tocWithCode[0].id === "real", JSON.stringify(tocWithCode));
    // 測試括號標題提取
    const tocWithParens = extractToc("## 時間線（重點事件）");
    push("extractToc 括號標題", tocWithParens.length === 1 && tocWithParens[0].id === "時間線重點事件", JSON.stringify(tocWithParens));
    // 基本輸出測試（不驗證完整 HTML，只驗證可轉換且非空）
    const bodyHtml = marked.parse("# T\n\n**bold**\n\n```bash\necho ok\n```");
    push("marked parse non-empty", typeof bodyHtml === "string" && bodyHtml.length > 0);
  } catch (e) {
    push("unexpected error in tests", false, String(e));
  }
  return results;
}

// 分割 Markdown 內容，提取時間線章節
function splitMarkdownForTimeline(markdown) {
  const timelineStart = markdown.indexOf('## 時間線（重點事件）');

  if (timelineStart === -1) {
    return { before: markdown, timeline: null, after: '' };
  }

  // 找到下一個 h2 標題作為時間線章節的結束
  const afterTimelineStart = timelineStart + '## 時間線（重點事件）'.length;
  const nextH2Match = markdown.slice(afterTimelineStart).match(/\n## /);
  const timelineEnd = nextH2Match
    ? afterTimelineStart + nextH2Match.index
    : markdown.length;

  return {
    before: markdown.slice(0, timelineStart),
    timeline: markdown.slice(timelineStart, timelineEnd),
    after: markdown.slice(timelineEnd)
  };
}

export default function ReportSite() {
  const title = TITLE_DEFAULT;
  const markdown = INITIAL_MD;
  const [dark, setDark] = useLocalStorage("msfs_report_dark", "1");

  const isDark = dark === "1";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  // 分割 Markdown 以插入時間線組件
  const { before, timeline, after } = useMemo(() => splitMarkdownForTimeline(markdown), [markdown]);


  const download = (filename, content, type = "text/plain") => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const exportMarkdown = () => download("msfs-proxmox-report.md", INITIAL_MD, "text/markdown;charset=utf-8");

  const exportHtml = () => {
    // 以 marked 預先轉為靜態 HTML，並內嵌極簡樣式，得到真正「單檔可部署」的網頁
    const bodyHtml = marked.parse(INITIAL_MD);
    const css = `:root{color-scheme: light dark}body{margin:0;padding:2rem;max-width:980px;margin-inline:auto;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,"Apple Color Emoji","Segoe UI Emoji"}a{color:inherit}pre{overflow:auto;background:#0b1020;color:#e6e6e6;padding:1rem;border-radius:12px}code{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono",monospace}.prose h1{font-size:2rem;margin-top:1.25rem}.prose h2{font-size:1.5rem;margin-top:1.25rem}.prose h3{font-size:1.25rem;margin-top:1rem}blockquote{padding:.5rem 1rem;border-left:4px solid #999;background:#f7f7f7;border-radius:8px}hr{border:none;border-top:1px solid #ddd;margin:2rem 0}table{border-collapse:collapse}th,td{border:1px solid #ccc;padding:.5rem;border-radius:4px}`;
    const html = `<!doctype html><html lang="zh-Hant-TW"><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${title}</title><style>${css}</style><body class="prose"><article>${bodyHtml}</article></body></html>`;
    download("msfs-proxmox-report.html", html, "text/html;charset=utf-8");
  };


  const components = {
    code({inline, children}) {
      if (inline) return (
        <code className="px-1.5 py-0.5 mx-0.5 rounded-lg bg-gradient-to-r from-blue-100 to-purple-100 dark:from-blue-900/30 dark:to-purple-900/30 text-blue-800 dark:text-blue-200 font-medium text-sm">
          {children}
        </code>
      );
      return <CodeBlock>{children}</CodeBlock>;
    },
    h1({children}) {
      const text = extractTextFromChildren(children);
      const id = slugify(text);
      return (
        <h1 id={id} className="scroll-mt-24 text-3xl font-bold tracking-tight">
          {children}
        </h1>
      );
    },
    h2({children}) {
      const text = extractTextFromChildren(children);
      const id = slugify(text);
      return (
        <h2 id={id} className="scroll-mt-24 text-2xl font-semibold mt-8">
          {children}
        </h2>
      );
    },
    h3({children}) {
      const text = extractTextFromChildren(children);
      const id = slugify(text);
      return (
        <h3 id={id} className="scroll-mt-24 text-xl font-semibold mt-6">
          {children}
        </h3>
      );
    },
    h4({children}) {
      const text = extractTextFromChildren(children);
      const id = slugify(text);
      return (
        <h4 id={id} className="scroll-mt-24 text-lg font-semibold mt-4">
          {children}
        </h4>
      );
    },
    a({href, children}) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="text-blue-600 dark:text-blue-400 underline decoration-2 decoration-blue-300 dark:decoration-blue-600 underline-offset-2 hover:decoration-blue-500 dark:hover:decoration-blue-400 transition-all hover:text-blue-700 dark:hover:text-blue-300"
        >
          {children}
        </a>
      );
    },
    blockquote({children}) {
      return (
        <blockquote className="border-l-4 border-orange-400 dark:border-orange-300 pl-4 py-2 my-4 bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-900/20 dark:to-amber-900/20 rounded-r-xl italic">
          {children}
        </blockquote>
      );
    },
  };

  // 初次載入時執行一次自測並在主控台輸出
  useEffect(() => {
    const results = runSelfTests();
    if (results.some(r => !r.pass)) {
      // 失敗時在畫面上也給提示（不干擾正常操作）
      console.warn("自測有失敗項目：", results);
    } else {
      console.log("自測通過：", results);
    }
  }, []);

  return (
    <div className="min-h-screen transition-colors duration-300 bg-gradient-to-br from-gray-50 via-white to-gray-100 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 text-neutral-900 dark:text-neutral-100">
      {/* Top Bar */}
      <div className="sticky top-0 z-10 backdrop-blur-xl bg-white/80 dark:bg-gray-900/80 border-b border-neutral-200/50 dark:border-neutral-800/50 shadow-lg dark:shadow-gray-900/30">
        <div className="mx-auto max-w-[1920px] px-6 py-4 flex items-center gap-3">
          <motion.div initial={{opacity:0,y:-6}} animate={{opacity:1,y:0}} className="flex items-center gap-2 grow">
            <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">
              {title}
            </h1>
          </motion.div>
          <div className="flex items-center gap-2">
            <button
              onClick={()=>setDark(isDark?"0":"1")}
              className="inline-flex items-center gap-2 rounded-xl bg-white/50 dark:bg-gray-800/50 backdrop-blur border border-neutral-300/50 dark:border-neutral-700/50 px-3 py-2 hover:bg-white/70 dark:hover:bg-gray-800/70 transition-all shadow-md"
              title={isDark?"切到淺色":"切到深色"}
            >
              {isDark ? <SunMedium size={16}/> : <Moon size={16}/>}{" "}<span className="hidden sm:inline">{isDark?"淺色":"深色"}</span>
            </button>
            <button
              onClick={exportMarkdown}
              className="inline-flex items-center gap-2 rounded-xl bg-white/50 dark:bg-gray-800/50 backdrop-blur border border-neutral-300/50 dark:border-neutral-700/50 px-3 py-2 hover:bg-white/70 dark:hover:bg-gray-800/70 transition-all shadow-md"
              title="匯出 Markdown"
            >
              <FileDown size={16}/>{" "}<span className="hidden sm:inline">MD</span>
            </button>
            <button
              onClick={exportHtml}
              className="inline-flex items-center gap-2 rounded-xl bg-white/50 dark:bg-gray-800/50 backdrop-blur border border-neutral-300/50 dark:border-neutral-700/50 px-3 py-2 hover:bg-white/70 dark:hover:bg-gray-800/70 transition-all shadow-md"
              title="匯出靜態 HTML"
            >
              <Download size={16}/>{" "}<span className="hidden sm:inline">HTML</span>
            </button>
            <button
              onClick={() => {
                const results = runSelfTests();
                const ok = results.every(r => r.pass);
                alert((ok ? "✅ 自我檢查通過" : "⚠️ 自我檢查有失敗") + "\n\n" + results.map(r => `${r.pass ? 'PASS' : 'FAIL'} - ${r.name}${r.extra ? ' -> ' + r.extra : ''}`).join('\n'));
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-50/50 dark:bg-emerald-900/20 backdrop-blur border border-emerald-300/50 dark:border-emerald-700/50 px-3 py-2 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100/50 dark:hover:bg-emerald-900/30 transition-all shadow-md"
              title="執行自我測試（slugify / extractToc / marked）"
            >
              <BugPlay size={16}/>{" "}<span className="hidden sm:inline">自我檢查</span>
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="mx-auto max-w-[1920px] px-6">
        <div className="grid grid-cols-1 xl:grid-cols-[320px,1fr] 2xl:grid-cols-[360px,1fr] gap-8 py-6">
          {/* TOC - 使用重構後的 TocContainer */}
          <TocContainer markdown={markdown} title="目錄" />

          {/* Main */}
          <main>
            <article className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm rounded-2xl p-8 md:p-10 lg:p-12 xl:p-14 2xl:p-16 shadow-xl dark:shadow-gray-900/50 prose prose-neutral dark:prose-invert max-w-none prose-lg xl:prose-xl">
              <h1 className="mb-2 text-4xl md:text-5xl font-black bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-400 dark:to-purple-400 bg-clip-text text-transparent">
                {title}
              </h1>
              <p className="mt-2 text-base text-gray-600 dark:text-gray-400 flex items-center gap-2">
                📄 MSFS on Proxmox with GPU Passthrough 技術報告。支援匯出 <strong className="text-blue-600 dark:text-blue-400">Markdown</strong> 與 <strong className="text-purple-600 dark:text-purple-400">靜態 HTML</strong>
              </p>

              {/* 渲染時間線前的內容 */}
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                {before}
              </ReactMarkdown>

              {/* 渲染時間線組件 */}
              {timeline && (
                <div id="時間線重點事件" className="scroll-mt-24">
                  <h2 className="text-2xl font-semibold mt-8 mb-4">時間線（重點事件）</h2>
                  <Timeline events={TIMELINE_EVENTS} />
                </div>
              )}

              {/* 渲染時間線後的內容 */}
              {after && (
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                  {after}
                </ReactMarkdown>
              )}
            </article>
          </main>
        </div>
      </div>
    </div>
  );
}
