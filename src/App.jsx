// @ts-nocheck
import React, {useEffect, useMemo, useRef, useState} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import { motion } from "framer-motion";
import { Download, FilePenLine, Moon, SunMedium, RotateCcw, Upload, FileDown, Clipboard, BugPlay } from "lucide-react";
import { marked } from "marked";

// -----------------------------
// 可編輯單頁網站 for jason5545 的 MSFS 報告
// - 左側 TOC 導覽、右側 Markdown 內容
// - 支援「編輯模式」(雙欄：左編右看)、本機自動儲存、導出 MD/HTML
// - Tailwind 風格、深色模式、代碼塊一鍵複製
// -----------------------------

const STORAGE_KEY = "msfs_report_markdown_v1";
const TITLE_DEFAULT = "MSFS on Proxmox with GPU Passthrough — 實戰報告（jason5545）";

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
  '  3) 觸發崩潰的直接因素是 **顯卡超頻**；移除後穩定。`rombar=0` 在本案**非必要**。',
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
  '- **9/26**：發佈 **最終整合指南**：從 Host 到 VM 的系統化優化與除錯；指出**超頻**為崩潰誘因、完成**核心綁定**與**驅動切換自動化**；GPU 利用率達 ~97%。另補 **`nvidia-drm.modeset=0`** 的說明與步驟。',
  '',
  '---',
  '',
  '## Host（Proxmox）層：IOMMU 與驅動管理',
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
  '**`rombar=0` 的位置與結論**：',
  '- 可避開部分 30/40 系列 ROM 相容性議題；',
  '- 但本案實測真正的崩潰誘因是 **顯卡超頻**，移除後不須 `rombar=0` 亦穩定；',
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
  '**`/etc/default/grub`**：IOMMU/ACS 與（可選）`nvidia-drm.modeset=0`。',
  '',
  '```bash',
  'GRUB_CMDLINE_LINUX_DEFAULT="quiet amd_iommu=on iommu=pt pcie_acs_override=downstream,multifunction nvidia-drm.modeset=0"',
  'update-grub && reboot',
  '```',
  '',
  '**`/etc/modprobe.d/vfio.conf` 與 `pve-blacklist.conf`**：softdep 與精準黑名單。',
  '',
  '```conf',
  'options vfio-pci ids=10de:2705,10de:22bb',
  'softdep nvidia pre: vfio-pci',
  'softdep nvidia_drm pre: vfio-pci',
  '# blacklist snd_hda_codec_hdmi',
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
  '- **成果**：完成 VM 啟停穩定（解決 pci_irq_handler 相關崩潰），**GPU 利用率 ~97%**，體感接近裸機。',
  '- **建議**：',
  '  1) 核心/PVE 升級後，檢查 `vfio`/`modprobe` 與 **hookscript** 邏輯是否仍適用；',
  '  2) 若再遇 DXGI/HANG 類問題，先回溯 **顯卡驅動版、超頻/溫度、遊戲內外掛** 等高階因子，再考慮 `rombar=0` 等低階繞法；',
  '  3) 持續以 **lm-sensors**、**NUT**、**UPS** 監控運維，維持長期穩定。',
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

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function extractToc(md) {
  const lines = md.split("\n");
  const items = [];
  for (const line of lines) {
    const m = /^(#{1,4})\s+(.+)$/.exec(line.trim());
    if (m) {
      const depth = m[1].length; // 1..4
      const title = m[2].replace(/`/g, "");
      const id = slugify(title);
      items.push({ depth, title, id });
    }
  }
  return items;
}

function CodeBlock({children}) {
  const text = String(children);
  const btnRef = useRef(null);
  return (
    <div className="group relative">
      <pre className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 overflow-x-auto text-sm bg-gray-50 dark:bg-gray-900">
        <code>{text}</code>
      </pre>
      <button
        ref={btnRef}
        onClick={() => {
          navigator.clipboard.writeText(text).then(() => {
            if (btnRef.current) {
              btnRef.current.innerText = "已複製";
              setTimeout(() => (btnRef.current.innerText = "複製"), 1200);
            }
          });
        }}
        className="absolute top-2 right-2 hidden group-hover:flex items-center gap-1 rounded-lg border border-gray-300 dark:border-gray-600 px-2 py-1 text-xs bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm"
        title="複製"
      >
        <Clipboard size={14} /> 複製
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
    const toc = extractToc(["# A", "", "## B", "### C"].join("\n"));
    push("extractToc length", toc.length === 3, JSON.stringify(toc));
    // 基本輸出測試（不驗證完整 HTML，只驗證可轉換且非空）
    const bodyHtml = marked.parse("# T\n\n**bold**\n\n```bash\necho ok\n```");
    push("marked parse non-empty", typeof bodyHtml === "string" && bodyHtml.length > 0);
  } catch (e) {
    push("unexpected error in tests", false, String(e));
  }
  return results;
}

export default function ReportSite() {
  const [title, setTitle] = useLocalStorage("msfs_report_title", TITLE_DEFAULT);
  const [markdown, setMarkdown] = useLocalStorage(STORAGE_KEY, INITIAL_MD);
  const [dark, setDark] = useLocalStorage("msfs_report_dark", "1");
  const [edit, setEdit] = useLocalStorage("msfs_report_edit", "0");

  const isDark = dark === "1";
  const isEdit = edit === "1";

  const toc = useMemo(() => extractToc(markdown), [markdown]);

  const fileInputRef = useRef(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  const resetToInitial = () => {
    if (confirm("確定要還原為初始報告內容？此動作無法復原。")) {
      setMarkdown(INITIAL_MD);
    }
  };

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

  const exportMarkdown = () => download("msfs-proxmox-report.md", markdown, "text/markdown;charset=utf-8");

  const exportHtml = () => {
    // 以 marked 預先轉為靜態 HTML，並內嵌極簡樣式，得到真正「單檔可部署」的網頁
    const bodyHtml = marked.parse(markdown);
    const css = `:root{color-scheme: light dark}body{margin:0;padding:2rem;max-width:980px;margin-inline:auto;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,"Apple Color Emoji","Segoe UI Emoji"}a{color:inherit}pre{overflow:auto;background:#0b1020;color:#e6e6e6;padding:1rem;border-radius:12px}code{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono",monospace}.prose h1{font-size:2rem;margin-top:1.25rem}.prose h2{font-size:1.5rem;margin-top:1.25rem}.prose h3{font-size:1.25rem;margin-top:1rem}blockquote{padding:.5rem 1rem;border-left:4px solid #999;background:#f7f7f7;border-radius:8px}hr{border:none;border-top:1px solid #ddd;margin:2rem 0}table{border-collapse:collapse}th,td{border:1px solid #ccc;padding:.5rem;border-radius:4px}`;
    const html = `<!doctype html><html lang="zh-Hant-TW"><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${title}</title><style>${css}</style><body class="prose"><article>${bodyHtml}</article></body></html>`;
    download("msfs-proxmox-report.html", html, "text/html;charset=utf-8");
  };

  const onImportFile = (file) => {
    const reader = new FileReader();
    reader.onload = () => setMarkdown(String(reader.result || ""));
    reader.readAsText(file);
  };

  const components = {
    code({inline, children}) {
      if (inline) return <code className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800">{children}</code>;
      return <CodeBlock>{children}</CodeBlock>;
    },
    h1({children}) {
      const text = String(children?.[0] ?? "");
      const id = slugify(text);
      return (
        <h1 id={id} className="scroll-mt-24 text-3xl font-bold tracking-tight">
          {children}
        </h1>
      );
    },
    h2({children}) {
      const text = String(children?.[0] ?? "");
      const id = slugify(text);
      return (
        <h2 id={id} className="scroll-mt-24 text-2xl font-semibold mt-8">
          {children}
        </h2>
      );
    },
    h3({children}) {
      const text = String(children?.[0] ?? "");
      const id = slugify(text);
      return (
        <h3 id={id} className="scroll-mt-24 text-xl font-semibold mt-6">
          {children}
        </h3>
      );
    },
    a({href, children}) {
      return <a href={href} target="_blank" rel="noreferrer" className="underline decoration-dotted hover:decoration-solid">{children}</a>;
    }
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
    <div className={`min-h-screen ${isDark ? "bg-neutral-950 text-neutral-100" : "bg-neutral-50 text-neutral-900"}`}>
      {/* Top Bar */}
      <div className="sticky top-0 z-10 backdrop-blur supports-[backdrop-filter]:bg-white/70 dark:supports-[backdrop-filter]:bg-neutral-900/60 border-b border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto max-w-[1400px] px-4 py-3 flex items-center gap-3">
          <motion.div initial={{opacity:0,y:-6}} animate={{opacity:1,y:0}} className="flex items-center gap-2 grow">
            <input
              value={title}
              onChange={(e)=>setTitle(e.target.value)}
              className="w-full max-w-[720px] bg-transparent outline-none text-lg font-semibold"
              aria-label="文件標題"
            />
          </motion.div>
          <div className="flex items-center gap-2">
            <button
              onClick={()=>setDark(isDark?"0":"1")}
              className="inline-flex items-center gap-2 rounded-xl border border-neutral-300 dark:border-neutral-700 px-3 py-1.5"
              title={isDark?"切到淺色":"切到深色"}
            >
              {isDark ? <SunMedium size={16}/> : <Moon size={16}/>}{" "}<span className="hidden sm:inline">{isDark?"淺色":"深色"}</span>
            </button>
            <button
              onClick={()=>setEdit(isEdit?"0":"1")}
              className="inline-flex items-center gap-2 rounded-xl border border-neutral-300 dark:border-neutral-700 px-3 py-1.5"
              title="切換編輯模式"
            >
              <FilePenLine size={16}/>{" "}<span className="hidden sm:inline">{isEdit?"閱讀":"編輯"}</span>
            </button>
            <button
              onClick={exportMarkdown}
              className="inline-flex items-center gap-2 rounded-xl border border-neutral-300 dark:border-neutral-700 px-3 py-1.5"
              title="匯出 Markdown"
            >
              <FileDown size={16}/>{" "}<span className="hidden sm:inline">MD</span>
            </button>
            <button
              onClick={exportHtml}
              className="inline-flex items-center gap-2 rounded-xl border border-neutral-300 dark:border-neutral-700 px-3 py-1.5"
              title="匯出靜態 HTML"
            >
              <Download size={16}/>{" "}<span className="hidden sm:inline">HTML</span>
            </button>
            <button
              onClick={resetToInitial}
              className="inline-flex items-center gap-2 rounded-xl border border-red-200 dark:border-red-900 px-3 py-1.5 text-red-600 dark:text-red-300"
              title="還原為初稿"
            >
              <RotateCcw size={16}/>{" "}<span className="hidden sm:inline">還原</span>
            </button>
            <button
              onClick={() => {
                const results = runSelfTests();
                const ok = results.every(r => r.pass);
                alert((ok ? "✅ 自我檢查通過" : "⚠️ 自我檢查有失敗") + "\n\n" + results.map(r => `${r.pass ? 'PASS' : 'FAIL'} - ${r.name}${r.extra ? ' -> ' + r.extra : ''}`).join('\n'));
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-300 dark:border-emerald-700 px-3 py-1.5"
              title="執行自我測試（slugify / extractToc / marked）"
            >
              <BugPlay size={16}/>{" "}<span className="hidden sm:inline">自我檢查</span>
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="mx-auto max-w-[1400px] px-4">
        <div className="grid grid-cols-1 lg:grid-cols-[280px,1fr] gap-6 py-6">
          {/* TOC */}
          <aside className="lg:sticky lg:top-[64px] h-max">
            <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold tracking-wide uppercase">目錄</h2>
                <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
                  <input type="checkbox" className="accent-neutral-900" onChange={(e)=>setEdit(e.target.checked?"1":"0")} checked={isEdit} /> 編輯
                </label>
              </div>
              <nav className="space-y-1 text-sm">
                {toc.map((t, idx) => (
                  <a key={idx} href={`#${t.id}`} className={`block truncate hover:underline ${t.depth===1?"pl-0 font-medium":""} ${t.depth===2?"pl-2":""} ${t.depth===3?"pl-4":""} ${t.depth===4?"pl-6":""}`}>
                    {t.title}
                  </a>
                ))}
              </nav>
              <hr className="my-3 border-neutral-200 dark:border-neutral-800"/>
              <div className="flex items-center justify-between">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".md, text/markdown, text/plain"
                  onChange={(e)=> e.target.files?.[0] && onImportFile(e.target.files[0])}
                  className="hidden"/>
                <button onClick={()=>fileInputRef.current?.click()} className="inline-flex items-center gap-2 rounded-xl border border-neutral-300 dark:border-neutral-700 px-3 py-1.5 text-xs">
                  <Upload size={14}/> 匯入 MD
                </button>
                <button onClick={()=>window.print()} className="inline-flex items-center gap-2 rounded-xl border border-neutral-300 dark:border-neutral-700 px-3 py-1.5 text-xs">
                  列印 / 存成 PDF
                </button>
              </div>
            </div>
          </aside>

          {/* Main */}
          <main>
            {isEdit ? (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <textarea
                  value={markdown}
                  onChange={(e)=>setMarkdown(e.target.value)}
                  className="min-h-[70vh] w-full rounded-2xl border border-neutral-300 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 font-mono text-sm"
                  spellCheck={false}
                />
                <article className="prose prose-neutral dark:prose-invert max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSlug]} components={components}>
                    {markdown}
                  </ReactMarkdown>
                </article>
              </div>
            ) : (
              <article className="prose prose-neutral dark:prose-invert max-w-none">
                <h1 className="mb-0">{title}</h1>
                <p className="mt-1 text-sm opacity-70">此頁可離線保存、再次載入與持續編輯。支援導出 <strong>Markdown</strong> 與 <strong>靜態 HTML</strong>。</p>
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSlug]} components={components}>
                  {markdown}
                </ReactMarkdown>
              </article>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
