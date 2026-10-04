//! 显示语言写入白名单，保持与前端语言目录一致。

pub fn validate_language(value: &str) -> Result<(), String> {
    if matches!(
        value,
        "system" | "en" | "zh-CN" | "zh-TW" | "ja" | "de" | "fr" | "es"
    ) {
        Ok(())
    } else {
        Err(format!("invalid language: {value}"))
    }
}

#[cfg(test)]
mod tests {
    use super::validate_language;

    #[test]
    fn accepts_system_and_all_bundled_languages() {
        for language in ["system", "en", "zh-CN", "zh-TW", "ja", "de", "fr", "es"] {
            assert!(validate_language(language).is_ok(), "{language}");
        }
    }

    #[test]
    fn rejects_unknown_or_malformed_preferences() {
        for language in ["", "EN", "en-US", "ru", "../en", "__proto__"] {
            assert!(validate_language(language).is_err(), "{language}");
        }
    }
}
