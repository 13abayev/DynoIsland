'use strict';
// Sums and unit conversions for Spotlight: "12*7", "(3+4)^2", "sqrt 2", "15% of 80", "5 km in mi", "30 c to f".
// Its own small parser, so nothing you type is ever run as code.

const FUNCS = {
  sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, ln: Math.log, log: Math.log10, exp: Math.exp,
};
const CONSTS = { pi: Math.PI, e: Math.E };

function tokens(text) {
  const out = [];
  const re = /\s*(?:(\d+(?:\.\d*)?|\.\d+)(?:e([+-]?\d+))?|([a-z]+)|(\*\*|[-+*/^%()×÷x]))/giy;
  let m, at = 0;
  while (at < text.length) {
    re.lastIndex = at;
    m = re.exec(text);
    if (!m) { if (/^\s*$/.test(text.slice(at))) break; return null; }
    at = re.lastIndex;
    if (m[1] != null) out.push({ n: Number(m[1] + (m[2] ? 'e' + m[2] : '')) });
    else if (m[3]) {
      const w = m[3].toLowerCase();
      if (w === 'x' && out.length && ('n' in out[out.length - 1] || out[out.length - 1].op === ')')) out.push({ op: '*' }); // 3 x 4
      else out.push({ id: w });
    } else out.push({ op: { '**': '^', '×': '*', '÷': '/', x: '*', X: '*' }[m[4]] || m[4] });
  }
  return out;
}

/** The value of a sum, or null when `text` is not one. */
function evaluate(text) {
  const t = tokens(text);
  if (!t || !t.length) return null;
  let i = 0;
  const peek = () => t[i], take = () => t[i++];
  const isOp = (tok, op) => tok && tok.op === op;
  // expr := term (('+'|'-') term)* ; term := power (('*'|'/') power | power)* ; power := unary ('^' power)? ;
  // unary := '-' unary | postfix ; postfix := atom '%'* ; atom := number | const | func atom | '(' expr ')'
  function expr() {
    let v = term();
    while (isOp(peek(), '+') || isOp(peek(), '-')) v = take().op === '+' ? v + term() : v - term();
    return v;
  }
  function term() {
    let v = power();
    for (;;) {
      if (isOp(peek(), '*')) { take(); v *= power(); } else if (isOp(peek(), '/')) { take(); v /= power(); }
      else if (peek() && ('n' in peek() || peek().id || isOp(peek(), '('))) v *= power(); // 2pi, 3(4+1)
      else return v;
    }
  }
  function power() {
    const v = unary();
    if (isOp(peek(), '^')) { take(); return Math.pow(v, power()); }
    return v;
  }
  function unary() {
    if (isOp(peek(), '-')) { take(); return -unary(); }
    if (isOp(peek(), '+')) { take(); return unary(); }
    let v = atom();
    while (isOp(peek(), '%')) { take(); v /= 100; }
    return v;
  }
  function atom() {
    const tok = take();
    if (!tok) throw new Error('end');
    if ('n' in tok) return tok.n;
    if (tok.id && tok.id in CONSTS) return CONSTS[tok.id];
    if (tok.id && tok.id in FUNCS) return FUNCS[tok.id](isOp(peek(), '(') ? atom() : power());
    if (isOp(tok, '(')) { const v = expr(); if (!isOp(take(), ')')) throw new Error(')'); return v; }
    throw new Error('unexpected');
  }
  try {
    const v = expr();
    return i === t.length && Number.isFinite(v) ? v : null;
  } catch { return null; }
}

const tidy = v => {
  if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
  return String(Number(v.toPrecision(12)));
};

/** "12*7" → { value: "84" }; "15% of 80" → { value: "12" }; null when it is not a sum (a plain number is not one). */
function calculate(input) {
  let text = String(input || '').trim().replace(/^=\s*/, '');
  if (!text) return null;
  text = text.replace(/(\d),(\d)/g, '$1.$2'); // 1,5 is 1.5 here
  const of = /^(.+?)\s*%\s*of\s+(.+)$/i.exec(text);
  if (of) {
    const p = evaluate(of[1]), whole = evaluate(of[2]);
    return p != null && whole != null ? { value: tidy((p / 100) * whole), text: `${of[1].trim()}% of ${of[2].trim()}` } : null;
  }
  if (!/[-+*/^%()×÷]|[a-z]{2,}|\d\s*x\s*\d/i.test(text) || /^[-+]?\d+(\.\d+)?$/.test(text)) return null; // needs an operation
  const v = evaluate(text);
  return v == null ? null : { value: tidy(v), text };
}

// ---------- conversions ----------
const UNITS = {
  length: { m: 1, mm: 1e-3, cm: 1e-2, km: 1e3, in: 0.0254, inch: 0.0254, inches: 0.0254, '"': 0.0254, ft: 0.3048, foot: 0.3048, feet: 0.3048, "'": 0.3048,
    yd: 0.9144, yard: 0.9144, yards: 0.9144, mi: 1609.344, mile: 1609.344, miles: 1609.344, meter: 1, meters: 1, metre: 1 },
  mass: { kg: 1, g: 1e-3, mg: 1e-6, t: 1e3, ton: 1e3, tonne: 1e3, lb: 0.45359237, lbs: 0.45359237, pound: 0.45359237, pounds: 0.45359237,
    oz: 0.028349523125, ounce: 0.028349523125, ounces: 0.028349523125, st: 6.35029318, stone: 6.35029318 },
  data: { b: 1, byte: 1, bytes: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 },
  time: { s: 1, sec: 1, secs: 1, second: 1, seconds: 1, ms: 1e-3, min: 60, mins: 60, minute: 60, minutes: 60, h: 3600, hr: 3600, hrs: 3600,
    hour: 3600, hours: 3600, d: 86400, day: 86400, days: 86400, wk: 604800, week: 604800, weeks: 604800 },
  volume: { l: 1, liter: 1, liters: 1, litre: 1, ml: 1e-3, gal: 3.785411784, gallon: 3.785411784, gallons: 3.785411784, cup: 0.2365882365, cups: 0.2365882365, floz: 0.0295735295625 },
  speed: { 'm/s': 1, 'km/h': 1 / 3.6, kmh: 1 / 3.6, kph: 1 / 3.6, mph: 0.44704, kn: 0.514444, knots: 0.514444 },
};
const TEMP = { c: 'c', '°c': 'c', celsius: 'c', f: 'f', '°f': 'f', fahrenheit: 'f', k: 'k', kelvin: 'k' };
const toC = { c: v => v, f: v => ((v - 32) * 5) / 9, k: v => v - 273.15 };
const fromC = { c: v => v, f: v => (v * 9) / 5 + 32, k: v => v + 273.15 };

/** "5 km in mi" → { value: "3.10686", text: "5 km = 3.10686 mi" }; null when it is not a conversion. */
function convert(input) {
  const m = /^\s*(-?\d+(?:[.,]\d+)?)\s*([a-z°/"']+)\s+(?:in|to|as|into|=)\s+([a-z°/"']+)\s*$/i.exec(String(input || ''));
  if (!m) return null;
  const n = Number(m[1].replace(',', '.')), from = m[2].toLowerCase(), to = m[3].toLowerCase();
  let v = null;
  if (TEMP[from] && TEMP[to]) v = fromC[TEMP[to]](toC[TEMP[from]](n));
  else for (const table of Object.values(UNITS)) if (from in table && to in table) { v = (n * table[from]) / table[to]; break; }
  if (v == null || !Number.isFinite(v)) return null;
  const value = String(Number(v.toPrecision(6)));
  return { value, text: `${m[1]} ${m[2]} = ${value} ${m[3]}` };
}

module.exports = { calculate, convert, evaluate };
