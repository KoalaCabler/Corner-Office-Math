// Small SEC EDGAR client: polite rate limiting, retries, and helpers for the
// endpoints this project uses. No outside packages (Node 18+ has fetch).
//
// The SEC asks every automated client to identify itself with a User-Agent
// that includes a contact email: https://www.sec.gov/os/accessing-edgar-data
// Set SEC_USER_AGENT, e.g. "CEO Pay Gap you@example.com".

const UA = process.env.SEC_USER_AGENT;
const MIN_GAP_MS = 125; // stays under the SEC's limit of 10 requests a second
let nextSlot = 0;

function requireUA() {
  if (!UA || !/@/.test(UA)) {
    throw new Error('Set SEC_USER_AGENT to a name and contact email, e.g. "CEO Pay Gap you@example.com". The SEC blocks requests without one.');
  }
}

async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_GAP_MS;
  if (wait) await new Promise(r => setTimeout(r, wait));
}

async function request(url, opts = {}) {
  requireUA();
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    await throttle();
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate', ...(opts.headers || {}) },
        signal: opts.signal,
      });
      if (res.status === 404) return null;
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status} for ${url}`);
        await new Promise(r => setTimeout(r, 2000 * 2 ** attempt));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return res;
    } catch (err) {
      if (opts.signal && opts.signal.aborted) throw err;
      lastErr = err;
      await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  throw lastErr;
}

async function getJSON(url) {
  const res = await request(url);
  return res ? res.json() : null;
}

async function getText(url) {
  const res = await request(url);
  return res ? res.text() : null;
}

// Reads a document in pieces and stops early once `isDone(textSoFar)` returns
// true or `maxBytes` is reached. Used for 10-Ks, where the employee count sits
// near the top of a file that can run to tens of megabytes.
async function getTextUntil(url, isDone, maxBytes = 8e6) {
  const ctrl = new AbortController();
  const res = await request(url, { signal: ctrl.signal });
  if (!res) return null;
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  let checkedAt = 0;
  try {
    for await (const chunk of res.body) {
      bytes += chunk.length;
      text += decoder.decode(chunk, { stream: true });
      if (bytes - checkedAt > 512e3) {
        checkedAt = bytes;
        if (isDone(text)) break;
      }
      if (bytes >= maxBytes) break;
    }
  } finally {
    ctrl.abort();
  }
  return text;
}

const pad = cik => String(cik).padStart(10, '0');

const companyFacts = cik => getJSON(`https://data.sec.gov/api/xbrl/companyfacts/CIK${pad(cik)}.json`);

// Every filing a company has made since `sinceDate`, newest first.
async function filings(cik, sinceDate) {
  const sub = await getJSON(`https://data.sec.gov/submissions/CIK${pad(cik)}.json`);
  if (!sub) return [];
  const out = [];
  const add = block => {
    for (let i = 0; i < block.accessionNumber.length; i++) {
      out.push({
        form: block.form[i],
        accession: block.accessionNumber[i],
        filingDate: block.filingDate[i],
        reportDate: block.reportDate[i] || null,
        primaryDocument: block.primaryDocument[i],
      });
    }
  };
  add(sub.filings.recent);
  // Busy filers (banks, utilities) push older filings into extra pages.
  for (const f of sub.filings.files || []) {
    if (f.filingTo < sinceDate) continue;
    const page = await getJSON(`https://data.sec.gov/submissions/${f.name}`);
    if (page) add(page);
  }
  return out.filter(f => f.filingDate >= sinceDate).sort((a, b) => b.filingDate.localeCompare(a.filingDate));
}

function documentUrl(cik, filing) {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${filing.accession.replace(/-/g, '')}/${filing.primaryDocument}`;
}

// The other HTML documents in a filing, largest first. Some companies file a
// short cover notice as the primary document and the proxy itself separately.
async function otherDocuments(cik, filing) {
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${filing.accession.replace(/-/g, '')}`;
  const idx = await getJSON(`${base}/index.json`);
  const items = (idx && idx.directory && idx.directory.item) || [];
  return items
    .filter(i => /\.html?$/i.test(i.name) && i.name !== filing.primaryDocument && !/index/i.test(i.name))
    .sort((a, b) => Number(b.size || 0) - Number(a.size || 0))
    .map(i => `${base}/${i.name}`);
}

function filingIndexUrl(cik, filing) {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${filing.accession.replace(/-/g, '')}/${filing.accession}-index.htm`;
}

module.exports = { getJSON, getText, getTextUntil, companyFacts, filings, documentUrl, otherDocuments, filingIndexUrl, requireUA, pad };
