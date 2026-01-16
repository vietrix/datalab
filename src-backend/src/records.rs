use serde_json::Value;
use xxhash_rust::xxh3::xxh3_64;

use crate::models::{FieldMap, PreviewField};

pub fn value_to_string(value: &Value) -> String {
  match value {
    Value::String(text) => text.clone(),
    Value::Null => String::new(),
    other => serde_json::to_string(other).unwrap_or_default(),
  }
}

pub fn truncate_text(text: &str, limit: usize) -> String {
  if text.len() <= limit {
    return text.to_string();
  }
  let mut out = text[..limit].to_string();
  out.push_str("...");
  out
}

pub fn extract_field_value(record: &Value, field: &Option<String>) -> Option<Value> {
  let field_name = field.as_ref()?;
  record
    .get(field_name)
    .cloned()
    .or_else(|| record.get(&field_name.to_lowercase()).cloned())
}

pub fn extract_text_value(record: &Value, field: &Option<String>) -> Option<String> {
  extract_field_value(record, field).map(|value| value_to_string(&value))
}

pub fn build_preview_fields(record: &Value, field_map: &FieldMap) -> Vec<PreviewField> {
  let mut fields = Vec::new();
  let mut used = Vec::new();

  let mut push_field = |name: &str, value: String, kind: &str| {
    if value.trim().is_empty() {
      return;
    }
    fields.push(PreviewField {
      name: name.to_string(),
      value: truncate_text(&value, 480),
      kind: kind.to_string(),
    });
  };

  if let Some(name) = &field_map.instruction {
    if let Some(value) = extract_text_value(record, &Some(name.clone())) {
      used.push(name.clone());
      push_field(name, value, "text");
    }
  }
  if let Some(name) = &field_map.output {
    if let Some(value) = extract_text_value(record, &Some(name.clone())) {
      used.push(name.clone());
      push_field(name, value, "text");
    }
  }
  if let Some(name) = &field_map.code {
    if let Some(value) = extract_text_value(record, &Some(name.clone())) {
      used.push(name.clone());
      push_field(name, value, "code");
    }
  }
  if let Some(name) = &field_map.category {
    if let Some(value) = extract_text_value(record, &Some(name.clone())) {
      used.push(name.clone());
      push_field(name, value, "meta");
    }
  }
  if let Some(name) = &field_map.score {
    if let Some(value) = extract_text_value(record, &Some(name.clone())) {
      used.push(name.clone());
      push_field(name, value, "meta");
    }
  }

  if fields.is_empty() {
    if let Some(map) = record.as_object() {
      for (name, value) in map.iter().take(2) {
        if used.contains(name) {
          continue;
        }
        fields.push(PreviewField {
          name: name.clone(),
          value: truncate_text(&value_to_string(value), 480),
          kind: "text".to_string(),
        });
      }
    }
  }

  fields
}

pub fn text_length(value: &str) -> usize {
  value.chars().count()
}

pub fn get_length_text(record: &Value, field_map: &FieldMap, scope: &str) -> String {
  match scope {
    "output" => extract_text_value(record, &field_map.output).unwrap_or_default(),
    "combined" => {
      let instruction = extract_text_value(record, &field_map.instruction).unwrap_or_default();
      let output = extract_text_value(record, &field_map.output).unwrap_or_default();
      format!("{instruction}\n{output}")
    }
    _ => extract_text_value(record, &field_map.instruction).unwrap_or_default(),
  }
}

pub fn tokenize(text: &str) -> Vec<String> {
  text
    .split(|c: char| !c.is_alphanumeric())
    .filter(|token| token.len() > 2)
    .map(|token| token.to_lowercase())
    .collect()
}

pub fn simhash(text: &str) -> u64 {
  let mut weights = [0i32; 64];
  for token in tokenize(text) {
    let hash = xxh3_64(token.as_bytes());
    for idx in 0..64 {
      if (hash >> idx) & 1 == 1 {
        weights[idx] += 1;
      } else {
        weights[idx] -= 1;
      }
    }
  }
  let mut out = 0u64;
  for idx in 0..64 {
    if weights[idx] > 0 {
      out |= 1u64 << idx;
    }
  }
  out
}

pub fn hamming_distance(a: u64, b: u64) -> u32 {
  (a ^ b).count_ones()
}
