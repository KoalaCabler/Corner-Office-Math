// Turns an EDGAR HTML filing into plain text that regexes can work on.

const ENTITIES = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: "'", lsquo: "'",
  rdquo: '"', ldquo: '"', ndash: '-', mdash: '-', minus: '-', hellip: '...', bull: ' ', middot: ' ',
  dollar: '$', percnt: '%', times: 'x', colon: ':', ensp: ' ', emsp: ' ', thinsp: ' ',
};

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (code === 160 || (code >= 8192 && code <= 8203)) return ' ';
      if (code === 8211 || code === 8212 || code === 8722) return '-';
      if (code === 8216 || code === 8217) return "'";
      if (code === 8220 || code === 8221) return '"';
      return code ? String.fromCodePoint(code) : '';
    }
    const v = ENTITIES[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<ix:header>[\s\S]*?<\/ix:header>/gi, ' ') // hidden inline-XBRL facts
      .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/?(p|div|br|tr|li|h[1-6]|table|section)\b[^>]*>/gi, '\n')
      .replace(/<\/?(td|th)\b[^>]*>/gi, ' | ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[  -​ ]/g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/ *\n[\n ]*/g, '\n');
}

// "1,234.5" / "1.2 million" -> number
function toNumber(digits, scale) {
  const n = parseFloat(String(digits).replace(/,/g, ''));
  if (!isFinite(n)) return null;
  const s = (scale || '').toLowerCase();
  if (s.startsWith('b')) return n * 1e9;
  if (s.startsWith('m')) return n * 1e6;
  if (s.startsWith('t') || s === 'k') return n * 1e3;
  return n;
}

module.exports = { htmlToText, decodeEntities, toNumber };
