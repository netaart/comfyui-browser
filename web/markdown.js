/* Owner: Sean */
const STYLE_ID = "comfyui-browser-markdown-style";

export function ensureMarkdownStyles(doc = globalThis.document) {
  if (!doc || doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .comfy-browser-markdown { color: #e5e7eb; font: 14px/1.65 system-ui, sans-serif; overflow-wrap: anywhere; }
    .comfy-browser-markdown h1,.comfy-browser-markdown h2,.comfy-browser-markdown h3,.comfy-browser-markdown h4 { color:#fff; font-weight:700; line-height:1.25; margin:1.2em 0 .55em; }
    .comfy-browser-markdown h1 { font-size:1.8em; border-bottom:1px solid #ffffff24; padding-bottom:.3em; }
    .comfy-browser-markdown h2 { font-size:1.45em; border-bottom:1px solid #ffffff20; padding-bottom:.25em; }
    .comfy-browser-markdown h3 { font-size:1.2em; }
    .comfy-browser-markdown p,.comfy-browser-markdown ul,.comfy-browser-markdown ol,.comfy-browser-markdown blockquote,.comfy-browser-markdown table,.comfy-browser-markdown pre { margin:.7em 0; }
    .comfy-browser-markdown ul,.comfy-browser-markdown ol { padding-left:1.7em; }
    .comfy-browser-markdown ul { list-style:disc; } .comfy-browser-markdown ol { list-style:decimal; }
    .comfy-browser-markdown blockquote { border-left:3px solid #64748b; padding:.1em 0 .1em 1em; color:#cbd5e1; }
    .comfy-browser-markdown a { color:#93c5fd; text-decoration:underline; }
    .comfy-browser-markdown code { border-radius:4px; background:#ffffff14; padding:.12em .35em; font: .9em ui-monospace,monospace; }
    .comfy-browser-markdown pre { overflow:auto; border-radius:6px; background:#080a0e; padding:12px; }
    .comfy-browser-markdown pre code { background:transparent; padding:0; }
    .comfy-browser-markdown hr { border:0; border-top:1px solid #ffffff30; margin:1.2em 0; }
    .comfy-browser-markdown table { border-collapse:collapse; width:100%; display:block; overflow:auto; }
    .comfy-browser-markdown th,.comfy-browser-markdown td { border:1px solid #ffffff30; padding:5px 9px; text-align:left; }
    .comfy-browser-markdown th { background:#ffffff12; }
    .comfy-browser-markdown img { max-width:100%; max-height:70vh; object-fit:contain; }
  `;
  doc.head.appendChild(style);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function resolveSafeUrl(rawUrl, baseUrl) {
  try {
    const url = new URL(rawUrl, baseUrl || globalThis.location?.href || "http://localhost/");
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function renderInline(text, baseUrl) {
  const tokens = [];
  const hold = (html) => `\uE000${tokens.push(html) - 1}\uE001`;
  let value = String(text);

  value = value.replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)/g, (_match, alt, rawUrl, title) => {
    const url = resolveSafeUrl(rawUrl, baseUrl);
    return url ? hold(`<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}"${title ? ` title="${escapeHtml(title)}"` : ""} loading="lazy">`) : escapeHtml(alt);
  });
  value = value.replace(/\[([^\]]+)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)/g, (_match, label, rawUrl, title) => {
    const url = resolveSafeUrl(rawUrl, baseUrl);
    return url ? hold(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"${title ? ` title="${escapeHtml(title)}"` : ""}>${escapeHtml(label)}</a>`) : escapeHtml(label);
  });
  value = value.replace(/`([^`]+)`/g, (_match, code) => hold(`<code>${escapeHtml(code)}</code>`));
  value = escapeHtml(value);
  value = value
    .replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_m, a, b) => `<strong>${a || b}</strong>`)
    .replace(/~~(.+?)~~/g, "<del>$1</del>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1<em>$2</em>");
  return value.replace(/\uE000(\d+)\uE001/g, (_match, index) => tokens[Number(index)] || "");
}

function splitTableRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

export function renderMarkdown(source, baseUrl = "") {
  ensureMarkdownStyles();
  const lines = String(source || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  const isBlockStart = (line, next = "") =>
    /^\s{0,3}(?:#{1,6}\s|```|~~~|>|[-*_]{3,}\s*$)/.test(line) ||
    /^\s*(?:[-+*]|\d+\.)\s+/.test(line) ||
    (line.includes("|") && /^\s*\|?\s*:?-{3,}/.test(next));

  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }

    const fence = line.match(/^\s{0,3}(```+|~~~+)(.*)$/);
    if (fence) {
      const code = [];
      i += 1;
      while (i < lines.length && !new RegExp(`^\\s{0,3}${fence[1][0]}{${fence[1].length},}\\s*$`).test(lines[i])) code.push(lines[i++]);
      if (i < lines.length) i += 1;
      blocks.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInline(heading[2], baseUrl)}</h${level}>`);
      i += 1;
      continue;
    }
    if (/^\s{0,3}(?:(\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(line)) {
      blocks.push("<hr>"); i += 1; continue;
    }

    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      const headers = splitTableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(splitTableRow(lines[i++]));
      blocks.push(`<table><thead><tr>${headers.map((cell) => `<th>${renderInline(cell, baseUrl)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((_h, col) => `<td>${renderInline(row[col] || "", baseUrl)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }

    if (/^\s{0,3}>/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) quote.push(lines[i++].replace(/^\s{0,3}>\s?/, ""));
      blocks.push(`<blockquote>${renderMarkdown(quote.join("\n"), baseUrl)}</blockquote>`);
      continue;
    }

    const listStart = line.match(/^\s{0,3}([-+*]|\d+\.)\s+(.+)$/);
    if (listStart) {
      const ordered = /\d/.test(listStart[1]);
      const items = [];
      while (i < lines.length) {
        const item = lines[i].match(/^\s{0,3}([-+*]|\d+\.)\s+(.+)$/);
        if (!item || /\d/.test(item[1]) !== ordered) break;
        items.push(`<li>${renderInline(item[2], baseUrl)}</li>`);
        i += 1;
      }
      const tag = ordered ? "ol" : "ul";
      blocks.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }

    const paragraph = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i], lines[i + 1] || "")) paragraph.push(lines[i++]);
    blocks.push(`<p>${renderInline(paragraph.join("\n").replace(/\n/g, " "), baseUrl)}</p>`);
  }
  return `<div class="comfy-browser-markdown">${blocks.join("\n")}</div>`;
}
