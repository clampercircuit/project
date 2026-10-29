const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

// Only allow explicit Markdown constructs; never insert HTML from a response.
function inline(text) {
  const pattern = /(`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*)/g;
  let result = '';
  let start = 0;
  for (const match of text.matchAll(pattern)) {
    result += escapeHtml(text.slice(start, match.index));
    const value = match[0];
    if (value.startsWith('`')) result += `<code>${escapeHtml(value.slice(1, -1))}</code>`;
    else if (value.startsWith('[')) {
      const link = value.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      result += `<a href="${escapeHtml(link[2])}" target="_blank" rel="noopener noreferrer">${escapeHtml(link[1])}</a>`;
    } else if (value.startsWith('**') || value.startsWith('__')) result += `<strong>${escapeHtml(value.slice(2, -2))}</strong>`;
    else result += `<em>${escapeHtml(value.slice(1, -1))}</em>`;
    start = match.index + value.length;
  }
  return result + escapeHtml(text.slice(start));
}

export function markdown(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let html = '';
  let paragraph = [];
  const flushParagraph = () => { if (paragraph.length) { html += `<p>${inline(paragraph.join('\n')).replaceAll('\n', '<br>')}</p>`; paragraph = []; } };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const fence = line.match(/^\s*```([\w+-]*)\s*$/);
    if (fence) {
      flushParagraph();
      const code = [];
      while (++index < lines.length && !/^\s*```\s*$/.test(lines[index])) code.push(lines[index]);
      html += `<div class="code-block"><div class="code-header"><span>${escapeHtml(fence[1] || 'code')}</span><button type="button" class="code-copy" aria-label="Copy code">${icon('copy')}<span>Copy</span></button></div><pre><code>${escapeHtml(code.join('\n'))}</code></pre></div>`;
      continue;
    }
    if (!line.trim()) { flushParagraph(); continue; }
    const heading = line.match(/^\s*(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      const level = Math.min(heading[1].length + 1, 4);
      html += `<h${level}>${inline(heading[2])}</h${level}>`;
      continue;
    }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) { flushParagraph(); html += '<hr>'; continue; }
    if (/^\s*>\s?/.test(line)) {
      flushParagraph();
      const quote = [line.replace(/^\s*>\s?/, '')];
      while (index + 1 < lines.length && /^\s*>/.test(lines[index + 1])) quote.push(lines[++index].replace(/^\s*>\s?/, ''));
      html += `<blockquote>${inline(quote.join('\n')).replaceAll('\n', '<br>')}</blockquote>`;
      continue;
    }
    if (line.includes('|') && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1])) {
      flushParagraph();
      const cells = row => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
      html += `<div class="table-wrap"><table><thead><tr>${cells(line).map(cell => `<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>`;
      index++;
      while (index + 1 < lines.length && lines[index + 1].includes('|') && lines[index + 1].trim()) {
        html += `<tr>${cells(lines[++index]).map(cell => `<td>${inline(cell)}</td>`).join('')}</tr>`;
      }
      html += '</tbody></table></div>';
      continue;
    }
    const list = line.match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.+)$/);
    if (list) {
      flushParagraph();
      const ordered = Boolean(list[2]);
      const tag = ordered ? 'ol' : 'ul';
      html += `<${tag}${ordered && list[2] !== '1' ? ` start="${Number(list[2])}"` : ''}>`;
      let current = list;
      do {
        let content = inline(current[3]);
        while (index + 1 < lines.length && /^\s{2,}\S/.test(lines[index + 1]) && !/^\s*(?:[-*+] |\d+[.)] |```|\|)/.test(lines[index + 1])) {
          content += '<br>' + inline(lines[++index].trim());
        }
        html += `<li>${content}</li>`;
        const next = lines[index + 1]?.match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.+)$/);
        if (!next || Boolean(next[2]) !== ordered) break;
        current = next;
        index++;
      } while (true);
      html += `</${tag}>`;
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  return html;
}

