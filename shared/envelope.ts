// Decode only the top-level answer string. Hidden memory is never streamed.
function stringAt(s: string, start: number) {
  if (s[start] !== '"') return null;
  let value = "";
  for (let i = start + 1; i < s.length; i++) {
    const c = s[i];
    if (c === '"') return { value, end: i + 1, complete: true };
    if (c === "\\") {
      if (i + 1 >= s.length) break;
      const escape = s[++i];
      if (escape === "u") {
        if (s.length < i + 5) break;
        const hex = s.slice(i + 1, i + 5);
        if (!/^[0-9a-f]{4}$/i.test(hex)) throw new Error("SUMMARY_FORMAT");
        value += String.fromCharCode(parseInt(hex, 16));
        i += 4;
      } else {
        const escapes: Record<string, string> = {
          '"': '"',
          "\\": "\\",
          "/": "/",
          n: "\n",
          r: "\r",
          t: "\t",
          b: "\b",
          f: "\f",
        };
        if (!(escape in escapes)) throw new Error("SUMMARY_FORMAT");
        value += escapes[escape];
      }
    } else {
      if (c.charCodeAt(0) < 32) throw new Error("SUMMARY_FORMAT");
      value += c;
    }
  }
  // Hold an incomplete UTF-16 surrogate until its second half arrives.
  if (/[\uD800-\uDBFF]$/.test(value)) value = value.slice(0, -1);
  return { value, end: s.length, complete: false };
}
const clean = (s: string) => s.trimStart().replace(/^```(?:json)?\s*/i, "");
export function envelopeAnswer(raw: string, requireComplete = false): string {
  const s = clean(raw);
  if (!s.startsWith("{")) return "";
  let i = 1;
  while (i < s.length) {
    while (/\s|,/.test(s[i] || "") && i < s.length) i++;
    const key = stringAt(s, i);
    if (!key?.complete) return "";
    i = key.end;
    while (/\s/.test(s[i] || "") && i < s.length) i++;
    if (s[i++] !== ":") return "";
    while (/\s/.test(s[i] || "") && i < s.length) i++;
    const value = stringAt(s, i);
    if (!value) return "";
    if (key.value === "answer")
      return requireComplete && !value.complete ? "" : value.value;
    if (!value.complete) return "";
    i = value.end;
  }
  return "";
}
export function parseEnvelope(raw: string) {
  try {
    const data = JSON.parse(clean(raw).replace(/\s*```\s*$/, ""));
    if (typeof data.answer !== "string" || !data.answer.trim())
      throw new Error();
    return {
      answer: data.answer as string,
      summary: typeof data.summary === "string" ? data.summary : "",
    };
  } catch {
    throw new Error("SUMMARY_FORMAT");
  }
}
