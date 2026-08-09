const escapeHtml = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const safeUrl = value => {
  const url = String(value || '').trim();
  return /^(https?:|mailto:)/i.test(url) ? escapeHtml(url) : '';
};

const inline = source => {
  const tokens = [];
  const reserve = html => `\u0000${tokens.push(html) - 1}\u0000`;
  let text = String(source ?? '');

  text = text.replace(/`([^`\n]+)`/g, (_, code) => reserve(`<code>${escapeHtml(code)}</code>`));
  text = text.replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)/g, (_, alt, url) => {
    const href = safeUrl(url);
    return reserve(href ? `<img class="ai-markdown-image" src="${href}" alt="${escapeHtml(alt)}" loading="lazy" referrerpolicy="no-referrer">` : escapeHtml(alt));
  });
  text = text.replace(/\[([^\]]+)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)/g, (_, label, url) => {
    const href = safeUrl(url);
    return reserve(href ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${inline(label)}</a>` : escapeHtml(label));
  });
  text = text.replace(/<(https?:\/\/[^\s>]+|mailto:[^\s>]+)>/gi, (_, url) => {
    const href = safeUrl(url);
    return reserve(`<a href="${href}" target="_blank" rel="noopener noreferrer">${escapeHtml(url.replace(/^mailto:/i, ''))}</a>`);
  });

  text = escapeHtml(text)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?:;])/g, '$1<em>$2</em>');

  return text.replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)] || '');
};

const splitCells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
const isDivider = line => splitCells(line).every(cell => /^:?-{3,}:?$/.test(cell));
const isBlockStart = (lines, index) => {
  const line = lines[index] || '';
  return /^\s*```/.test(line) || /^#{1,6}\s+/.test(line) || /^\s*>/.test(line) || /^\s*([-+*])\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line) || /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line) || (line.includes('|') && isDivider(lines[index + 1] || ''));
};

const renderList = (lines, start, ordered) => {
  const expression = ordered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-+*]\s+(.+)$/;
  const items = [];
  let index = start;
  while (index < lines.length) {
    const match = lines[index].match(expression);
    if (!match) break;
    const task = match[1].match(/^\[([ xX])\]\s+(.*)$/);
    items.push(task
      ? `<li class="task-list-item"><input type="checkbox" disabled ${task[1].toLowerCase() === 'x' ? 'checked' : ''}><span>${inline(task[2])}</span></li>`
      : `<li>${inline(match[1])}</li>`);
    index++;
  }
  const tag = ordered ? 'ol' : 'ul';
  return { html: `<${tag}>${items.join('')}</${tag}>`, next: index };
};

export function renderMarkdown(source) {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
  const output = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }

    const fence = line.match(/^\s*```\s*([\w.+#-]*)\s*$/);
    if (fence) {
      const code = [];
      index++;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index++;
      const language = fence[1] ? ` data-language="${escapeHtml(fence[1])}"` : '';
      output.push(`<pre${language}><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) { output.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); index++; continue; }
    if (index + 1 < lines.length && /^\s*(=+|-+)\s*$/.test(lines[index + 1]) && line.trim()) {
      const level = lines[index + 1].trim().startsWith('=') ? 1 : 2;
      output.push(`<h${level}>${inline(line.trim())}</h${level}>`);
      index += 2;
      continue;
    }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { output.push('<hr>'); index++; continue; }

    if (/^\s*>/.test(line)) {
      const quote = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) quote.push(lines[index++].replace(/^\s*>\s?/, ''));
      output.push(`<blockquote>${renderMarkdown(quote.join('\n'))}</blockquote>`);
      continue;
    }

    if (/^\s*[-+*]\s+/.test(line)) { const list = renderList(lines, index, false); output.push(list.html); index = list.next; continue; }
    if (/^\s*\d+[.)]\s+/.test(line)) { const list = renderList(lines, index, true); output.push(list.html); index = list.next; continue; }

    if (line.includes('|') && isDivider(lines[index + 1] || '')) {
      const headers = splitCells(line);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) rows.push(splitCells(lines[index++]));
      output.push(`<div class="ai-markdown-table-wrap"><table><thead><tr>${headers.map(cell => `<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${headers.map((_, cell) => `<td>${inline(row[cell] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }

    const paragraph = [line];
    index++;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) paragraph.push(lines[index++]);
    output.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
  }

  return output.join('');
}
