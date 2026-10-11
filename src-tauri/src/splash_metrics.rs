pub struct SplashWord {
    pub gap_px: f64,
    pub size_px: f64,
}

pub const MARK_PX: i32 = 92;
pub const WORD: &str = "Handshaker";
#[cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(dead_code))]
pub const MARK_PNG: &[u8] = include_bytes!("splash-mark-184.png");

const SPLASH_HTML: &str = include_str!("../../index.html");

pub fn splash_word() -> Option<SplashWord> {
    let start = SPLASH_HTML.find("#splash .splash-word")?;
    let block = SPLASH_HTML[start..].split('}').next()?;
    let gap_px = css_px(block, "margin-top:")?;
    let size_px = css_font_px(block)?;
    Some(SplashWord { gap_px, size_px })
}

fn css_px(block: &str, prop: &str) -> Option<f64> {
    let rest = block.split(prop).nth(1)?;
    let num: String = rest
        .trim_start()
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    let value = num.parse().ok()?;
    if value > 0.0 {
        Some(value)
    } else {
        None
    }
}

fn css_font_px(block: &str) -> Option<f64> {
    let rest = block.split("font:").nth(1)?;
    rest.split_whitespace()
        .filter_map(|token| token.strip_suffix("px"))
        .find_map(|px| px.parse::<f64>().ok().filter(|n| *n > 0.0))
}

#[cfg(test)]
mod tests {
    use super::{splash_word, MARK_PNG};

    #[test]
    fn splash_word_reads_the_inline_margin_and_font() {
        let word = splash_word().expect("splash word");
        let start = super::SPLASH_HTML
            .find("#splash .splash-word")
            .expect("rule");
        let block = super::SPLASH_HTML[start..]
            .split('}')
            .next()
            .expect("block");
        assert!(block.contains(&format!("margin-top: {}px", word.gap_px)));
        assert!(block.contains(&format!("{}px", word.size_px)));
    }

    #[test]
    fn mark_png_is_a_png() {
        assert!(MARK_PNG.starts_with(b"\x89PNG\r\n\x1a\n"));
    }
}
