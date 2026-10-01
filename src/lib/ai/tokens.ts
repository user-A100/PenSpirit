/** 与后端 util::estimate_tokens 同一口径：中日韩字 ×1.6 + 拉丁词 ×1.3（向上取整） */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let latin = 0;
  let inWord = false;
  for (const ch of text) {
    if (/[㐀-鿿豈-﫿぀-ヿ가-힯]/.test(ch)) {
      cjk++;
      inWord = false;
    } else if (/[A-Za-z0-9]/.test(ch)) {
      if (!inWord) latin++;
      inWord = true;
    } else inWord = false;
  }
  return Math.ceil(cjk * 1.6 + latin * 1.3);
}
