export function isCjk(code: number): boolean {
  return (code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf)
    || (code >= 0xf900 && code <= 0xfaff) || (code >= 0x20000 && code <= 0x2a6df);
}

export function countWords(text: string): number {
  let cjk = 0, latin = 0, inWord = false;
  for (const ch of text) {
    if (isCjk(ch.codePointAt(0)!)) { cjk++; inWord = false; }
    else if (/[a-z0-9]/i.test(ch)) { if (!inWord) { latin++; inWord = true; } }
    else { inWord = false; }
  }
  return cjk + latin;
}
