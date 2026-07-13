const META_SCAN_BYTES = 8 * 1024;

function normalizeCharset(value: string | undefined) {
  const charset = value?.trim().toLowerCase().replace(/^['"]|['"]$/g, '');
  if (!charset) return 'utf-8';
  if (charset === 'gbk' || charset === 'gb2312' || charset === 'gb_2312-80') return 'gb18030';
  return charset;
}

function charsetFromContentType(contentType: string | undefined) {
  return contentType?.match(/charset\s*=\s*['"]?([^\s;'"]+)/i)?.[1];
}

function charsetFromHtmlMeta(bytes: Uint8Array) {
  const probe = new TextDecoder('iso-8859-1').decode(bytes.slice(0, META_SCAN_BYTES));
  const direct = probe.match(/<meta\b[^>]*\bcharset\s*=\s*['"]?([^\s'"/>]+)/i)?.[1];
  if (direct) return direct;
  return probe.match(/<meta\b[^>]*\bcontent\s*=\s*['"][^'"]*charset\s*=\s*([^\s;'"]+)/i)?.[1];
}

/** Decode a response body using its HTTP charset, then its HTML meta charset. */
export function decodeHttpText(bytes: Uint8Array, contentType?: string) {
  const charset = normalizeCharset(charsetFromContentType(contentType) ?? charsetFromHtmlMeta(bytes));
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}
