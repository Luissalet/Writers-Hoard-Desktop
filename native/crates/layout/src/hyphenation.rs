//! Language-specific print hyphenation; offsets always address the original text.
use std::collections::HashMap;
use std::sync::OnceLock;

use unicode_normalization::UnicodeNormalization;
use unicode_segmentation::UnicodeSegmentation;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Provider {
    Spanish,
    English,
    Unsupported,
}

pub fn provider(language: Option<&str>) -> Provider {
    match language.unwrap_or("en-US").split(['-', '_']).next().unwrap_or("").to_ascii_lowercase().as_str() {
        "es" => Provider::Spanish,
        "en" => Provider::English,
        _ => Provider::Unsupported,
    }
}

impl Provider {
    pub fn name(self) -> &'static str {
        match self {
            Self::Spanish => "spanish-patterns",
            Self::English => "english-dictionary-patterns",
            Self::Unsupported => "unsupported-language",
        }
    }
}

pub fn is_word_char(c: char) -> bool {
    c.is_alphabetic() || unicode_normalization::char::is_combining_mark(c) || matches!(c, '\'' | '’')
}

pub fn is_address(text: &str) -> bool {
    let text = text.to_ascii_lowercase();
    let leading = text.trim_start_matches(['(', '[', '{', '<', '"', '\'']);
    text.contains("://") || text.contains('@') || leading.starts_with("www.") || leading.starts_with("//")
}

/// Byte ranges of addresses are excluded before splitting prose into words.
pub(crate) fn address_ranges(text: &str) -> Vec<std::ops::Range<usize>> {
    text.split_whitespace()
        .filter(|token| is_address(token))
        .map(|token| {
            let start = (token.as_ptr() as usize).saturating_sub(text.as_ptr() as usize);
            start..start + token.len()
        })
        .collect()
}

#[derive(Default)]
struct PatternNode {
    children: HashMap<char, usize>,
    weights: Vec<u8>,
}

/// The Spanish resource contains patterns longer than the English packed key.
/// This trie accepts the whole resource, with no fixed alphabet or pattern length.
struct SpanishPatterns {
    nodes: Vec<PatternNode>,
}

impl SpanishPatterns {
    fn parse(text: &str) -> Self {
        let mut patterns = Self { nodes: vec![PatternNode::default()] };
        for line in text.lines() {
            let line = line.trim();
            if line.is_empty()
                || line.starts_with(['%', '#'])
                || line == "UTF-8"
                || line.starts_with("LEFTHYPHENMIN")
                || line.starts_with("RIGHTHYPHENMIN")
            {
                continue;
            }
            let mut node = 0;
            let mut weights = vec![0];
            for c in line.chars() {
                if let Some(weight) = c.to_digit(10) {
                    if let Some(last) = weights.last_mut() {
                        *last = weight as u8;
                    }
                } else {
                    let child = patterns.nodes.get(node).and_then(|n| n.children.get(&c)).copied();
                    node = match child {
                        Some(child) => child,
                        None => {
                            let child = patterns.nodes.len();
                            patterns.nodes.push(PatternNode::default());
                            if let Some(parent) = patterns.nodes.get_mut(node) {
                                parent.children.insert(c, child);
                            }
                            child
                        }
                    };
                    weights.push(0);
                }
            }
            if let Some(leaf) = patterns.nodes.get_mut(node) {
                leaf.weights.resize(weights.len(), 0);
                for (stored, incoming) in leaf.weights.iter_mut().zip(weights) {
                    *stored = (*stored).max(incoming);
                }
            }
        }
        patterns
    }

    fn points(&self, word: &str) -> Vec<usize> {
        let chars: Vec<_> = std::iter::once('.').chain(word.chars()).chain(std::iter::once('.')).collect();
        let mut weights = vec![0u8; chars.len() + 1];
        for start in 0..chars.len() {
            let mut node = 0;
            for c in chars.iter().skip(start) {
                let Some(child) = self.nodes.get(node).and_then(|n| n.children.get(c)).copied() else {
                    break;
                };
                node = child;
                if let Some(leaf) = self.nodes.get(node) {
                    for (index, weight) in leaf.weights.iter().enumerate() {
                        if let Some(stored) = weights.get_mut(start + index) {
                            *stored = (*stored).max(*weight);
                        }
                    }
                }
            }
        }
        let length = word.chars().count();
        (2..length.saturating_sub(1)).filter(|index| weights.get(index + 1).is_some_and(|value| value % 2 == 1)).collect()
    }
}

fn spanish() -> &'static SpanishPatterns {
    static PATTERNS: OnceLock<SpanishPatterns> = OnceLock::new();
    PATTERNS.get_or_init(|| SpanishPatterns::parse(include_str!("../../../assets/hyphenation/es.dic")))
}

/// Original UTF-8 byte boundaries, never inside an NFD grapheme.
pub fn word_points(word: &str, language: Option<&str>) -> Vec<usize> {
    if is_address(word) || word.is_empty() || !word.chars().all(is_word_char) || word.chars().any(writer_fonts::is_rtl) {
        return Vec::new();
    }
    let selected = provider(language);
    let apostrophe = |c: char| matches!(c, '\'' | '’' | 'ʼ');
    let (lookup, base) = if selected == Provider::Spanish {
        let start = word.len() - word.trim_start_matches(apostrophe).len();
        let end = word.trim_end_matches(apostrophe).len();
        let core = word.get(start..end).unwrap_or("");
        // An internal elision is outside this pattern corpus, not an English suffix.
        if core.is_empty() || core.chars().any(apostrophe) {
            return Vec::new();
        }
        (core, start)
    } else {
        (word, 0)
    };
    let mut normalized = String::new();
    let mut original_boundaries = vec![Some(base)];
    for (start, grapheme) in lookup.grapheme_indices(true) {
        let lower: String = if selected == Provider::Spanish { grapheme.to_lowercase().nfc().collect() } else { grapheme.nfc().collect() };
        let count = lower.chars().count();
        normalized.push_str(&lower);
        original_boundaries.extend(std::iter::repeat_n(None, count));
        if let Some(boundary) = original_boundaries.last_mut() {
            *boundary = Some(base + start + grapheme.len());
        }
    }
    let points = match provider(language) {
        Provider::Spanish => spanish().points(&normalized),
        Provider::English => writer_proof::hyphen::hyphen_points(&normalized, &writer_proof::hyphen::Limits::default()),
        Provider::Unsupported => Vec::new(),
    };
    points
        .into_iter()
        .filter_map(|point| original_boundaries.get(point).copied().flatten())
        .filter(|point| *point > 0 && *point < word.len())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn spanish_reference_words_digraphs_and_minima() {
        for (word, expected) in [("documentación", vec![2, 4, 7, 9]), ("niñez", vec![2]), ("ferrocarril", vec![2, 5, 7]), ("lluvia", vec![3])] {
            let points = word_points(word, Some("es-ES"));
            assert_eq!(points.iter().map(|point| word[..*point].chars().count()).collect::<Vec<_>>(), expected, "{word}");
        }
        for word in ["a", "de", "ñ", "2026", "https://example.org/a-b", "test@example.org", "//documentacion.es/a-b"] {
            assert!(word_points(word, Some("es-ES")).is_empty(), "{word}");
        }
    }
    #[test]
    fn decomposed_original_offsets_and_foreign_languages() {
        let word = "DOCUMENTACIO\u{301}N";
        let points = word_points(word, Some("es"));
        assert_eq!(points, vec![2, 4, 7, 9]);
        assert_eq!(word_points("nin\u{303}ez", Some("es-ES")), vec![2]);
        assert!(word_points("documentación", Some("unknown")).is_empty());
        assert_eq!(word_points("hyphenation", None), word_points("hyphenation", Some("en-US")));
        for word in ["INTERNATIONAL", "REPRESENTATION"] {
            assert!(word_points(word, Some("en-US")).is_empty());
        }
    }
    #[test]
    fn spanish_outer_quotes_do_not_count_toward_word_minima() {
        assert_eq!(word_points("niñez’", Some("es-ES")), vec![2]);
        assert_eq!(word_points("documentación’", Some("es-ES")), vec![2, 4, 7, 9]);
        assert_eq!(word_points("’niñez’", Some("es-ES")), vec![5]);
        assert!(word_points("pa’l", Some("es-ES")).is_empty());
    }
    #[test]
    fn full_length_patterns_are_not_discarded() {
        let patterns = SpanishPatterns::parse(".ab1cdefghijklm.\n");
        assert_eq!(patterns.points("abcdefghijklm"), vec![2]);
    }
}
