// @ts-nocheck
import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion } from "framer-motion";
import { Download, Moon, SunMedium, FileDown, Clipboard, BugPlay } from "lucide-react";
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
  '- **9/26**：發佈 **最終整合指南**：從 Host 到 VM 的系統化優化與除錯；指出**超頻**為錯誤誘因、完成**核心綁定**與**驅動切換自動化**；GPU 利用率達 ~97%。另補 **`nvidia-drm.modeset=0`** 的說明與步驟。同時確認 BIOS 中 **Resizable BAR 設為 OFF**。',
  '- **9/27 晚間**：新增 **NVIDIA 驅動相關黑名單**優化設定，包含 `nvidia_modeset`、`nvidia_uvm`、`nvidia_drm` 等模組黑名單，以確保 VFIO 與 NVIDIA 驅動之間的穩定切換。',
  '- **9/28**：開始進行 **PMDG 777F 長程測試航班**（東京羽田 RJTT → 杜拜 OMDB），驗證系統在高負載長時間運作下的穩定性與效能表現。',
  `- **9/28 長程飛行測試發現**：
  - 在 **PMDG 777F** 長程測試中發現，只要觸發遊戲暫停選單，相對容易觸發 **VFIO reset/restore bar** 問題
  - 已進一步縮小範圍至 **Windows 事件管理器**中的 **NVIDIA TOPPS** 相關錯誤
  - 根據社群回報，此問題可能與 **顯示記憶體管理**有關
  - 經測試確認 **hookscript 並非問題來源**，問題仍在持續追查中
  - **OCCT 穩定性測試**：使用 OCCT 進行 80% 顯示記憶體壓力測試，經過 40 多輪測試後顯示沒有異常，確認顯示記憶體本身穩定`,
  '',
  '---',
  '',
  '## Host（Proxmox）層：IOMMU 與驅動管理',
  '**BIOS 設定**（9/26 確認）：',
  '',
  '```',
  'Resizable BAR: OFF',
  '```',
  '',
  '> **重要說明**：Resizable BAR 在 GPU 直通環境下可能導致相容性問題。建議在 BIOS 中停用此功能，以確保 VFIO 和 VM 的穩定運作。某些情況下，啟用 Resizable BAR 可能會導致 VM 無法正常啟動或 GPU 驅動異常。',
  '',
  '**GRUB 參數**（啟用 IOMMU/ACS，必要時加上 `nvidia-drm.modeset=0`）：',
  '',
  '```bash',
  '# /etc/default/grub',
  'GRUB_CMDLINE_LINUX_DEFAULT="quiet amd_iommu=on iommu=pt pcie_acs_override=downstream,multifunction nvidia-drm.modeset=0"',
  '# 套用後：',
  'sudo update-grub && sudo reboot',
  '```',
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
  '**9/27 晚間補充：NVIDIA 驅動相關黑名單優化**：',
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
  'IOMMU: Enable',
  'VT-d / AMD-Vi: Enable',
  '```',
  '',
  '**`/etc/default/grub`**：IOMMU/ACS 與（可選）`nvidia-drm.modeset=0`。',
  '',
  '```bash',
  'GRUB_CMDLINE_LINUX_DEFAULT="quiet amd_iommu=on iommu=pt pcie_acs_override=downstream,multifunction nvidia-drm.modeset=0"',
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

export default function ReportSite() {
  const title = TITLE_DEFAULT;
  const markdown = INITIAL_MD;
  const [dark, setDark] = useLocalStorage("msfs_report_dark", "1");

  const isDark = dark === "1";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);


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
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                {markdown}
              </ReactMarkdown>
            </article>
          </main>
        </div>
      </div>
    </div>
  );
}
