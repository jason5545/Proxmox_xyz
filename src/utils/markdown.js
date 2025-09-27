import { marked } from "marked";

export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

export function extractToc(markdown) {
  return markdown
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .reduce((items, line) => {
      const match = /^(#{1,4})\s+(.+)$/.exec(line);
      if (match) {
        const depth = match[1].length;
        const title = match[2].replace(/`/g, "");
        items.push({ depth, title, id: slugify(title) });
      }
      return items;
    }, []);
}

export function buildStandaloneHtml(markdown, title) {
  const bodyHtml = marked.parse(markdown);
  const css = `:root{color-scheme:light dark}body{margin:0;padding:2rem;max-width:980px;margin-inline:auto;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,"Apple Color Emoji","Segoe UI Emoji"}a{color:inherit}pre{overflow:auto;background:#0b1020;color:#e6e6e6;padding:1rem;border-radius:12px}code{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono",monospace}.prose h1{font-size:2rem;margin-top:1.25rem}.prose h2{font-size:1.5rem;margin-top:1.25rem}.prose h3{font-size:1.25rem;margin-top:1rem}blockquote{padding:.5rem 1rem;border-left:4px solid #999;background:#f7f7f7;border-radius:8px}hr{border:none;border-top:1px solid #ddd;margin:2rem 0}table{border-collapse:collapse}th,td{border:1px solid #ccc;padding:.5rem;border-radius:4px}`;
  return `<!doctype html><html lang="zh-Hant-TW"><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${title}</title><style>${css}</style><body class="prose"><article>${bodyHtml}</article></body></html>`;
}
