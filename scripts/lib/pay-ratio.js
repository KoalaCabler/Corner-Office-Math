// Finds the CEO pay ratio disclosure (Item 402(u) of Regulation S-K) in the
// plain text of a proxy statement and pulls out three numbers:
//   - the CEO's annual total compensation (as reported in the Summary
//     Compensation Table, sometimes annualized for a mid-year CEO change)
//   - the median employee's annual total compensation
//   - the ratio between them
//
// Companies word this paragraph many different ways, so the parser does not
// trust any single phrase. It collects every dollar amount and every
// "N to 1" ratio near the disclosure and keeps the combination where
// CEO / median ~= ratio. That cross-check is what makes the result reliable.

const { toNumber } = require('./text');

const DOLLAR = /\$[\s|]*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s*(million|billion|thousand))?/gi;
const RATIO = /(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(?:to|-to-|:)\s*(?:1|one)(?![\d,.]*\d)/gi;
// A few companies write it the other way round: "a ratio of 1-to-43".
const RATIO_INVERTED = /\b(?:1|one)\s*(?:to|-to-|:)\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?![\d,]*\d)(?!\s*(?:to|-to-|:)\s*1\b)/gi;
const BARE_NUMBER = /(?<![\d,.$])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?![\d,]*\d)(?!\s*(?:%|percent|to\b|-to-|:))/g;
const RATIO_TIMES = /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*times\b/gi;
const MEDIAN_WORD = /median\s+(?:compensated\s+)?(?:employee|associate|team\s*member|worker|colleague|partner|individual|of\s+(?:the\s+)?annual)|median\s+of\s+the\s+annual|median\s+annual/gi;
const CEO_WORD = /\b(?:ceo|chief executive|pe0|principal executive|president and ceo|our chairman)/gi;
const EMPLOYEES = /(?:population|workforce|total|consisted|comprised|had|employed|employ|of)\s+(?:of\s+)?(?:approximately|about|over|more than|nearly|roughly|around|a total of)?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(thousand|million)?\s+(?:(?:full[- ]time|part[- ]time|global|worldwide|total|active|u\.s\.|non-u\.s\.|regular|individual|and|or|seasonal|temporary|,)\s+)*(?:employees|associates|team members|colleagues|people|workers|individuals|personnel)/gi;

const PROPOSAL_WORDS = /proponent|shareholder proposal|stockholder proposal|supporting statement|\bibid\b|resolved:/i;

function allMatches(re, text, base = 0) {
  if (!re.global) re = new RegExp(re.source, re.flags + 'g'); // exec() on a non-global regex never advances
  re.lastIndex = 0;
  const out = [];
  let m;
  while ((m = re.exec(text))) out.push({ m, index: base + m.index });
  return out;
}

// Spots in the text that look like the pay ratio section.
function findWindows(text) {
  const anchors = [];
  for (const { index } of allMatches(/pay ratio|ratio of (?:the )?(?:annual )?(?:total )?compensation|ratio (?:of|between) (?:our )?(?:ceo|chief executive)|ceo[- ]to[- ](?:median|employee)|median (?:compensated )?employee/gi, text)) anchors.push(index);
  if (!anchors.length) return [];
  // Merge nearby anchors into windows of text.
  anchors.sort((a, b) => a - b);
  const windows = [];
  for (const a of anchors) {
    const start = Math.max(0, a - 1500);
    const end = Math.min(text.length, a + 4500);
    const last = windows[windows.length - 1];
    if (last && start <= last.end) last.end = Math.max(last.end, end);
    else windows.push({ start, end });
  }
  return windows;
}

function nearWord(re, text, index, span) {
  const from = Math.max(0, index - span);
  const slice = text.slice(from, index + span);
  return allMatches(re, slice).length > 0;
}

function distanceToWord(re, text, index, span) {
  const from = Math.max(0, index - span);
  const slice = text.slice(from, index + 40);
  const hits = allMatches(re, slice);
  if (!hits.length) return Infinity;
  return Math.min(...hits.map(h => Math.abs(from + h.index - index)));
}

function parsePayRatio(text) {
  const windows = findWindows(text);
  let best = null;

  for (const w of windows) {
    const chunk = text.slice(w.start, w.end);
    if (!/median/i.test(chunk)) continue;

    const dollars = allMatches(DOLLAR, chunk).map(({ m, index }) => ({ value: toNumber(m[1], m[2]), index }))
      .filter(d => d.value != null);
    let ratios = allMatches(RATIO, chunk).map(({ m, index }) => ({ value: toNumber(m[1]), index, kind: 'to1' }));
    ratios = ratios.concat(allMatches(RATIO_INVERTED, chunk).map(({ m, index }) => ({ value: toNumber(m[1]), index, kind: 'inverted' })));
    ratios = ratios.concat(allMatches(RATIO_TIMES, chunk).map(({ m, index }) => ({ value: toNumber(m[1]), index, kind: 'times' })));
    // Some companies state the ratio as a bare number: "for 2025 is 330." or
    // a table cell "Ratio of CEO to Median Employee ... | 81.7". Only
    // numbers shortly after the word "ratio" count, and the cross-check
    // below must still hold.
    for (const { index } of allMatches(/ratio/gi, chunk)) {
      const after = chunk.slice(index, index + 220);
      for (const { m, index: j } of allMatches(BARE_NUMBER, after)) {
        const v = toNumber(m[1]);
        if (v == null || (Number.isInteger(v) && v >= 1990 && v <= 2040)) continue;
        if (/\$[\s|]*$/.test(after.slice(0, j))) continue;
        ratios.push({ value: v, index: index + j, kind: 'bare' });
      }
    }
    ratios = ratios.filter(r => r.value != null && r.value <= 100000);

    const medians = dollars.filter(d => d.value >= 3000 && d.value <= 700000);
    // A CEO who took no pay ($0 at Tesla, 2021-2023) or a token amount
    // ($2.75 at Block) is real; small figures only pair with a ratio under 1.
    const ceos = dollars.filter(d => d.value <= 5e9);

    for (const r of ratios) {
      for (const md of medians) {
        for (const c of ceos) {
          if (c.index === md.index) continue;
          if (c.value < 50000 && r.value >= 1) continue;
          const implied = c.value / md.value;
          // Ratios are rounded, so allow rounding slack.
          const err = r.value < 0.01 ? (implied < 0.01 ? 0 : 1) : Math.abs(implied - r.value) / r.value;
          if (err > 0.03 && (r.value < 5 || Math.abs(implied - r.value) > 1.01)) continue;
          const spread = Math.abs(r.index - md.index) + Math.abs(r.index - c.index);
          let score = err * 100 + spread / 400;
          if (r.kind === 'times') score += 2;
          if (r.kind === 'inverted') score += 1;
          if (r.kind === 'bare') score += 2;
          // Supplemental ratios ("using realized pay, the ratio was ...") come second.
          if (/realized|supplemental|alternative|additional ratio/i.test(chunk.slice(Math.max(0, r.index - 200), r.index))) score += 3;
          if (distanceToWord(MEDIAN_WORD, chunk, md.index, 400) > 400) score += 3;
          if (distanceToWord(CEO_WORD, chunk, c.index, 500) > 500) score += 1;
          if (!nearWord(/ratio/i, chunk, r.index, 300)) score += 2;
          // Shareholder proposals sometimes quote other years' or other
          // companies' ratios. Prefer the company's own disclosure.
          if (nearWord(PROPOSAL_WORDS, text, w.start + r.index, 2500)) score += 20;
          if (!best || score < best.score) {
            best = {
              score,
              ceoPay: c.value,
              medianPay: md.value,
              payRatio: r.value,
              method: 'cross-checked',
              offset: w.start + Math.min(r.index, md.index, c.index),
            };
          }
        }
      }
    }

    // Fallback: a ratio and a median pay figure, but the CEO total is not in
    // this paragraph (it points to the Summary Compensation Table instead).
    if (!best) {
      for (const r of ratios.filter(x => x.kind === 'to1' && nearWord(/ratio/i, chunk, x.index, 300))) {
        const md = medians
          .filter(d => distanceToWord(MEDIAN_WORD, chunk, d.index, 300) <= 300)
          .sort((a, b) => Math.abs(a.index - r.index) - Math.abs(b.index - r.index))[0];
        if (md) {
          const cand = { score: 50, ceoPay: null, medianPay: md.value, payRatio: r.value, method: 'ratio-and-median', offset: w.start + Math.min(r.index, md.index) };
          if (!best || cand.score < best.score) best = cand;
        }
      }
    }
  }

  if (!best) return null;

  // Employee head count, if the disclosure mentions it.
  const around = text.slice(Math.max(0, best.offset - 4000), best.offset + 4000);
  const counts = allMatches(EMPLOYEES, around)
    .map(({ m }) => toNumber(m[1], m[2]))
    .filter(n => n >= 500 && n <= 3e6);
  const employees = counts.length ? Math.max(...counts) : null;

  // The fiscal year the disclosure is about, when it names one ("for 2023", "fiscal 2023").
  const yearHits = allMatches(/(?:fiscal(?: year)?|for|in|during|year ended [a-z]+ \d{1,2},)\s+(20[12]\d)\b/gi, text.slice(Math.max(0, best.offset - 2500), best.offset + 1500))
    .map(({ m }) => Number(m[1]));
  const statedYear = yearHits.length ? mode(yearHits) : null;

  return {
    ceoPay: best.ceoPay,
    medianPay: best.medianPay,
    payRatio: best.payRatio,
    method: best.method,
    employees,
    statedYear,
    excerpt: text.slice(Math.max(0, best.offset - 300), best.offset + 500).replace(/\s+/g, ' ').trim(),
  };
}

function mode(arr) {
  const counts = new Map();
  for (const v of arr) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
}

// Employee head count from a 10-K's "Human Capital" / "Employees" section.
function parseEmployees10K(text) {
  const hc = text.search(/human capital|\bemployees\s*\n|\bour (?:employees|people|workforce)\s*\n/i);
  const zones = hc >= 0 ? [text.slice(hc, hc + 6000), text] : [text];
  const re = /(?:had|employed|employ|employs|workforce of|total of|consisted of|comprised|approximately|about|over|more than)\s+(?:approximately|about|over|more than|nearly|roughly|around|a total of)?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(thousand|million)?\s+(?:(?:full[- ]time|part[- ]time|global|worldwide|total|active|regular|and|,)\s+)*(?:employees|associates|team members|colleagues|people|workers|personnel)/gi;
  // In the Human Capital section take the largest figure (the total, not
  // "approximately 250 employees in our Dublin office"); elsewhere the first.
  for (const [i, zone] of zones.entries()) {
    const hits = allMatches(re, zone).map(({ m }) => toNumber(m[1], m[2])).filter(n => n >= 100 && n <= 3e6);
    if (hits.length) return i === 0 && zones.length > 1 ? Math.max(...hits) : hits[0];
  }
  return null;
}

module.exports = { parsePayRatio, parseEmployees10K };
