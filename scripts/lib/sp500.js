// The current S&P 500 member list, with each company's SEC CIK number, read
// from Wikipedia's "List of S&P 500 companies" table. A copy is saved to
// data/sp500.json so the site still builds if Wikipedia is unreachable.

const fs = require('fs');
const path = require('path');
const { decodeEntities } = require('./text');

const FILE = path.join(__dirname, '..', '..', 'data', 'sp500.json');
const URL = 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies';

function cellText(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function parseTable(html) {
  const start = html.search(/<table[^>]*id="constituents"/i);
  if (start < 0) throw new Error('S&P 500 table not found on the Wikipedia page');
  const table = html.slice(start, html.indexOf('</table>', start));
  const rows = table.split(/<tr[^>]*>/i).slice(1);
  const header = (rows.shift().match(/<th[^>]*>[\s\S]*?(?=<th|$)/gi) || []).map(cellText).map(h => h.toLowerCase());
  const col = name => header.findIndex(h => h.includes(name));
  const iSym = col('symbol'), iName = col('security'), iSector = col('sector'), iSub = col('sub-industry'), iCik = col('cik'), iHq = col('headquarters'), iAdded = col('added');
  if (iSym < 0 || iCik < 0) throw new Error('Unexpected columns in the S&P 500 table: ' + header.join(', '));
  const out = [];
  for (const row of rows) {
    const cells = (row.match(/<td[^>]*>[\s\S]*?(?=<td|$)/gi) || []).map(cellText);
    if (cells.length < header.length - 1) continue;
    const cik = Number(cells[iCik]);
    if (!cik) continue;
    out.push({
      ticker: cells[iSym],
      name: cells[iName],
      sector: cells[iSector] || null,
      industry: iSub >= 0 ? cells[iSub] : null,
      headquarters: iHq >= 0 ? cells[iHq] : null,
      dateAdded: iAdded >= 0 ? cells[iAdded] : null,
      cik,
    });
  }
  if (out.length < 450) throw new Error(`Only found ${out.length} S&P 500 rows; the page layout may have changed`);
  return out;
}

async function loadSp500({ refresh = true } = {}) {
  if (refresh) {
    try {
      const res = await fetch(URL, { headers: { 'User-Agent': 'ceo-pay-gap data builder (https://github.com)' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const list = parseTable(await res.text());
      fs.writeFileSync(FILE, JSON.stringify(list, null, 1));
      return list;
    } catch (err) {
      console.warn(`Could not refresh the S&P 500 list (${err.message}); using the saved copy.`);
    }
  }
  if (!fs.existsSync(FILE)) throw new Error('No saved S&P 500 list at data/sp500.json');
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}

module.exports = { loadSp500, parseTable };
