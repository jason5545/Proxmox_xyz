import initialMarkdown from "../content/initial-report.md?raw";

export const STORAGE_KEY = "msfs_report_markdown_v1";
export const TITLE_DEFAULT = "MSFS on Proxmox with GPU Passthrough — 實戰報告（jason5545）";

export const INITIAL_MD = initialMarkdown.replace(/\r\n/g, "\n").trim();
