// @ts-nocheck
import React, {useEffect, useMemo, useRef} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import { motion } from "framer-motion";
import { Download, FilePenLine, Moon, SunMedium, RotateCcw, Upload, FileDown, Clipboard, BugPlay } from "lucide-react";

import { INITIAL_MD, STORAGE_KEY, TITLE_DEFAULT } from "./constants/report";
import { useLocalStorage } from "./hooks/useLocalStorage";
import { buildStandaloneHtml, extractToc, slugify } from "./utils/markdown";
import { runSelfTests } from "./utils/selfTest";

// -----------------------------
// 可編輯單頁網站 for jason5545 的 MSFS 報告
// - 左側 TOC 導覽、右側 Markdown 內容
// - 支援「編輯模式」(雙欄：左編右看)、本機自動儲存、導出 MD/HTML
// - Tailwind 風格、深色模式、代碼塊一鍵複製
// -----------------------------

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
    const html = buildStandaloneHtml(markdown, title);
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
