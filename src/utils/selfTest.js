import { marked } from "marked";
import { extractToc, slugify } from "./markdown";

export function runSelfTests() {
  const results = [];
  const push = (name, pass, extra = "") => results.push({ name, pass, extra });

  try {
    push("slugify basic", slugify("Hello World") === "hello-world");
    push("slugify 中文+英數", slugify("測試 Test 123") === "測試-test-123");

    const toc = extractToc(["# A", "", "## B", "### C"].join("\n"));
    push("extractToc length", toc.length === 3, JSON.stringify(toc));

    const bodyHtml = marked.parse("# T\n\n**bold**\n\n```bash\necho ok\n```");
    push("marked parse non-empty", typeof bodyHtml === "string" && bodyHtml.length > 0);
  } catch (error) {
    push("unexpected error in tests", false, String(error));
  }

  return results;
}
