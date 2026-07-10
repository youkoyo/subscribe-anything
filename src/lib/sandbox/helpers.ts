/**
 * Pre-compiled helper functions injected into the isolated-vm sandbox.
 *
 * These are plain JavaScript strings that context.eval() compiles.
 * We keep them in a separate .ts file so TypeScript validates the
 * string content and we avoid template-literal escaping bugs.
 *
 * All string escaping is done with JSON.stringify(), not template literals.
 */

// The opening <» and closing «» markers are placeholders that get replaced
// with actual regex literal delimiters at injection time. This avoids the
// JSON-transport escaping problem entirely.
const R = '«'; // regex open
const S = '»'; // regex close

export const HELPER_SCRIPTS: string[] = [
  // ─── fetch polyfill ──────────────────────────────────────────
  `globalThis.fetch = async function(url, opts) {
    var j = await __hostFetch.apply(undefined, [String(url), JSON.stringify(opts ?? {})], { arguments: { copy: true }, result: { copy: true, promise: true } });
    var d = JSON.parse(j);
    return { ok: d.ok, status: d.status, statusText: d.statusText, headers: d.headers, text: function() { return Promise.resolve(d.body); }, json: function() { return Promise.resolve(JSON.parse(d.body)); } };
  };`,

  // ─── console ─────────────────────────────────────────────────
  `globalThis.__consoleLogs = [];
  globalThis.console = { log: function() { globalThis.__consoleLogs.push(Array.prototype.slice.call(arguments).join(' ')); } };`,

  // ─── URLSearchParams ─────────────────────────────────────────
  `globalThis.URLSearchParams = class {
    constructor(init) { this._p = []; if (!init) return; if (typeof init === 'string') { var s = init.startsWith('?') ? init.slice(1) : init; if (s) { var parts = s.split('&'); for (var pi = 0; pi < parts.length; pi++) { var eq = parts[pi].indexOf('='); this._p.push(eq < 0 ? [decodeURIComponent(parts[pi]), ''] : [decodeURIComponent(parts[pi].slice(0, eq)), decodeURIComponent(parts[pi].slice(eq + 1))]); } } } else if (Array.isArray(init)) { for (var j = 0; j < init.length; j++) this._p.push([String(init[j][0]), String(init[j][1])]); } else if (typeof init === 'object') { var keys = Object.keys(init); for (var k = 0; k < keys.length; k++) this._p.push([String(keys[k]), String(init[keys[k]])]); } }
    get(k) { var f = this._p.filter(function(x) { return x[0] === k; }); return f.length ? f[0][1] : null; }
    getAll(k) { return this._p.filter(function(x) { return x[0] === k; }).map(function(x) { return x[1]; }); }
    has(k) { return this._p.some(function(x) { return x[0] === k; }); }
    append(k, v) { this._p.push([String(k), String(v)]); }
    delete(k) { this._p = this._p.filter(function(x) { return x[0] !== k; }); }
    set(k, v) { var n = this._p.filter(function(x) { return x[0] !== k; }); n.push([String(k), String(v)]); this._p = n; }
    toString() { return this._p.map(function(x) { return encodeURIComponent(x[0]) + '=' + encodeURIComponent(x[1]); }).join('&'); }
    forEach(fn) { this._p.forEach(function(x) { fn(x[1], x[0]); }); }
    keys() { return this._p.map(function(x) { return x[0]; })[Symbol.iterator](); }
    values() { return this._p.map(function(x) { return x[1]; })[Symbol.iterator](); }
    entries() { return this._p[Symbol.iterator](); }
    [Symbol.iterator]() { return this._p[Symbol.iterator](); }
  };`,

  // ─── URL ─────────────────────────────────────────────────────
  `globalThis.URL = class {
    constructor(url, base) { var j; try { j = __hostResolveURL.applySync(undefined, [String(url), base != null ? String(base) : undefined], { arguments: { copy: true }, result: { copy: true } }); } catch(e) { throw new TypeError('Invalid URL: ' + url); } var d = JSON.parse(j); this.href = d.href; this.origin = d.origin; this.protocol = d.protocol; this.host = d.host; this.hostname = d.hostname; this.port = d.port; this.pathname = d.pathname; this.search = d.search; this.hash = d.hash; this.username = d.username; this.password = d.password; this.searchParams = new globalThis.URLSearchParams(d.search ? d.search.slice(1) : ''); }
    toString() { return this.href; } toJSON() { return this.href; }
    static canParse(url, base) { try { new globalThis.URL(url, base); return true; } catch { return false; } }
  };`,

  // ─── __htmlGetText ──────────────────────────────────────────
  `globalThis.__htmlGetText = function(html) {
    if (!html) return '';
    var s = html;
    // Remove script and style blocks
    s = s.replace(/<script[«s«S]*?<[/]script>/gi, ' ').replace(/<style[«s«S]*?<[/]style>/gi, ' ');
    // Remove HTML tags
    s = s.replace(/<[^>]*>/g, ' ');
    // Decode entities
    s = s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
    s = s.replace(/&#x([0-9a-fA-F]+);/g, function(_,h) { var c = parseInt(h,16); return isNaN(c) ? ' ' : String.fromCodePoint(c); });
    s = s.replace(/&#(\\d+);/g, function(_,d) { var c = parseInt(d,10); return isNaN(c) ? ' ' : String.fromCodePoint(c); });
    return s.replace(/[«s]+/g, ' ').trim();
  };`,

  // ─── __htmlGetByTag ─────────────────────────────────────────
  `globalThis.__htmlGetByTag = function(html, tag) {
    if (!html || !tag) return [];
    var results = [];
    var lower = html.toLowerCase();
    var tagLower = tag.toLowerCase();
    var pos = 0;
    while (true) {
      var openStart = lower.indexOf('<' + tagLower, pos);
      if (openStart < 0) break;
      var openEnd = lower.indexOf('>', openStart);
      if (openEnd < 0) break;
      var closeTag = '<' + '/' + tagLower + '>';
      var closeStart = lower.indexOf(closeTag, openEnd + 1);
      if (closeStart < 0) break;
      results.push(html.slice(openEnd + 1, closeStart));
      pos = closeStart + closeTag.length;
    }
    return results;
  };`,

  // ─── __htmlGetAttr ──────────────────────────────────────────
  `globalThis.__htmlGetAttr = function(tagStr, attr) {
    if (!tagStr || !attr) return null;
    var lower = tagStr.toLowerCase();
    var search = attr.toLowerCase() + '=';
    var idx = lower.indexOf(search);
    if (idx < 0) return null;
    idx += search.length;
    var quote = tagStr[idx];
    if (quote === '"' || quote === "'") {
      var end = tagStr.indexOf(quote, idx + 1);
      return end < 0 ? null : tagStr.slice(idx + 1, end);
    }
    var end = tagStr.indexOf(' ', idx);
    if (end < 0) end = tagStr.length;
    return tagStr.slice(idx, end);
  };`,

  // ─── __htmlGetLinks ─────────────────────────────────────────
  `globalThis.__htmlGetLinks = function(html) {
    if (!html) return [];
    var results = [];
    var lower = html.toLowerCase();
    var pos = 0;
    while (true) {
      var aStart = lower.indexOf('<a ', pos);
      if (aStart < 0) break;
      var aEnd = lower.indexOf('>', aStart);
      if (aEnd < 0) break;
      var closeA = lower.indexOf('</a>', aEnd);
      if (closeA < 0) break;
      var tagStr = html.slice(aStart, aEnd + 1);
      var href = globalThis.__htmlGetAttr(tagStr, 'href');
      var text = globalThis.__htmlGetText(html.slice(aEnd + 1, closeA));
      if (href) results.push({ href: href, text: text });
      pos = closeA + 4;
    }
    return results;
  };`,

  // ─── __htmlGetElements ──────────────────────────────────────
  `globalThis.__htmlGetElements = function(html, tag) {
    if (!html || !tag) return [];
    var results = [];
    var lower = html.toLowerCase();
    var tagLower = tag.toLowerCase();
    var pos = 0;
    while (true) {
      var openStart = lower.indexOf('<' + tagLower, pos);
      if (openStart < 0) break;
      var openEnd = lower.indexOf('>', openStart);
      if (openEnd < 0) break;
      var closeTag = '<' + '/' + tagLower + '>';
      var closeStart = lower.indexOf(closeTag, openEnd + 1);
      if (closeStart < 0) break;
      var openTagStr = html.slice(openStart, openEnd + 1);
      var inner = html.slice(openEnd + 1, closeStart);
      var attrs = {};
      var attrStart = openTagStr.indexOf(' ');
      if (attrStart > 0) {
        var attrStr = openTagStr.slice(attrStart + 1, openTagStr.length - 1);
        // Match key="val" or key='val' patterns
        var attrIdx = 0;
        while (attrIdx < attrStr.length) {
          var eqIdx = attrStr.indexOf('=', attrIdx);
          if (eqIdx < 0) break;
          var key = '';
          // Backtrack past whitespace to find key start
          for (var bi = eqIdx - 1; bi >= 0; bi--) {
            if (attrStr[bi] === ' ' || attrStr[bi] === '«t' || attrStr[bi] === '«n' || attrStr[bi] === '«r') { key = attrStr.slice(bi + 1, eqIdx).trim(); break; }
          }
          if (!key) { key = attrStr.slice(Math.max(0, attrStr.lastIndexOf(' ', eqIdx) + 1), eqIdx).trim(); }
          if (key) {
            var qi = eqIdx + 1;
            if (attrStr[qi] === '"' || attrStr[qi] === "'") {
              var q = attrStr[qi];
              var ve = attrStr.indexOf(q, qi + 1);
              if (ve >= 0) { attrs[key] = attrStr.slice(qi + 1, ve); attrIdx = ve + 1; continue; }
            }
            // unquoted value
            var ve2 = attrStr.indexOf(' ', qi);
            if (ve2 < 0) ve2 = attrStr.length;
            attrs[key] = attrStr.slice(qi, ve2);
            attrIdx = ve2 + 1;
            continue;
          }
          attrIdx = eqIdx + 1;
        }
      }
      results.push({ text: globalThis.__htmlGetText(inner), html: inner, attrs: attrs });
      pos = closeStart + closeTag.length;
    }
    return results;
  };`,
];

/**
 * Assemble all helpers into a single script string, replacing « → \ and » → nothing.
 * The «» markers avoid having literal \s, \S, etc. in the source strings that would
 * get mangled by template-literal or JSON escaping.
 */
export function assembleHelpers(): string {
  return HELPER_SCRIPTS
    .join('\n')
    .replace(/«/g, '\\')
    .replace(/»/g, '');
}
