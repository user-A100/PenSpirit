pub fn is_cjk(c: char) -> bool {
    matches!(c as u32,
        0x4E00..=0x9FFF | 0x3400..=0x4DBF | 0xF900..=0xFAFF | 0x20000..=0x2A6DF)
}

pub fn count_words(text: &str) -> i64 {
    let (mut cjk, mut latin, mut in_word) = (0i64, 0i64, false);
    for ch in text.chars() {
        if is_cjk(ch) {
            cjk += 1;
            in_word = false;
        } else if ch.is_ascii_alphanumeric() {
            if !in_word {
                latin += 1;
                in_word = true;
            }
        } else {
            in_word = false;
        }
    }
    cjk + latin
}
