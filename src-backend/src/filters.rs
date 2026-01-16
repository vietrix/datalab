use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::Value;

use crate::models::{CategoryCount, FieldMap, FilterConfig, FilterSummary};
use crate::records::{
  extract_text_value, get_length_text, hamming_distance, simhash, text_length, value_to_string,
};
use crate::state::DatasetStore;

pub fn apply_filters_inner(
  store: &DatasetStore,
  filters: &FilterConfig,
  field_map: &FieldMap,
  cancel: &AtomicBool,
  mut on_progress: impl FnMut(usize, usize),
) -> Result<(Vec<usize>, FilterSummary), String> {
  let mut required_fields = filters.require_fields.clone();
  if required_fields.is_empty() {
    if let Some(name) = &field_map.instruction {
      required_fields.push(name.clone());
    }
    if let Some(name) = &field_map.output {
      required_fields.push(name.clone());
    }
  }

  let include_keywords = if filters.keyword_case_sensitive {
    filters.include_keywords.clone()
  } else {
    filters
      .include_keywords
      .iter()
      .map(|k| k.to_lowercase())
      .collect()
  };
  let exclude_keywords = if filters.keyword_case_sensitive {
    filters.exclude_keywords.clone()
  } else {
    filters
      .exclude_keywords
      .iter()
      .map(|k| k.to_lowercase())
      .collect()
  };

  let category_field = filters
    .category_field
    .clone()
    .or_else(|| field_map.category.clone());
  let category_filter: HashSet<String> = filters
    .categories
    .iter()
    .map(|cat| cat.to_lowercase())
    .collect();

  let mut exact_seen: HashSet<String> = HashSet::new();
  let mut fuzzy_buckets: HashMap<u16, Vec<u64>> = HashMap::new();
  let mut filtered_ids = Vec::new();
  let mut duplicates_removed = 0usize;

  let file = File::open(&store.store_path).map_err(|e| e.to_string())?;
  let reader = BufReader::new(file);

  for (idx, line) in reader.lines().enumerate() {
    if cancel.load(Ordering::SeqCst) {
      return Err("Filter canceled".to_string());
    }
    let line = line.map_err(|e| e.to_string())?;
    if line.trim().is_empty() {
      continue;
    }
    let record: Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;

    if !required_fields.is_empty() {
      let mut missing = false;
      for field in &required_fields {
        let value = record.get(field);
        if value.is_none() || value == Some(&Value::Null) {
          missing = true;
          break;
        }
        if let Some(Value::String(text)) = value {
          if text.trim().is_empty() {
            missing = true;
            break;
          }
        }
      }
      if missing {
        continue;
      }
    }

    let length_text = get_length_text(&record, field_map, &filters.length_scope);
    let length = text_length(&length_text) as u32;
    if let Some(min_len) = filters.min_length {
      if length < min_len {
        continue;
      }
    }
    if let Some(max_len) = filters.max_length {
      if length > max_len {
        continue;
      }
    }

    let keyword_text = if filters.keyword_case_sensitive {
      length_text.clone()
    } else {
      length_text.to_lowercase()
    };
    if !include_keywords.is_empty()
      && !include_keywords
        .iter()
        .all(|keyword| keyword_text.contains(keyword))
    {
      continue;
    }
    if exclude_keywords
      .iter()
      .any(|keyword| keyword_text.contains(keyword))
    {
      continue;
    }

    if let Some(category_field) = &category_field {
      if !category_filter.is_empty() {
        let category_value = record
          .get(category_field)
          .map(|value| value_to_string(value).to_lowercase())
          .unwrap_or_default();
        if !category_filter.contains(&category_value) {
          continue;
        }
      }
    }

    let instruction_text = extract_text_value(&record, &field_map.instruction).unwrap_or_default();
    if filters.dedupe_exact && !instruction_text.is_empty() {
      let normalized = instruction_text
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();
      if !exact_seen.insert(normalized) {
        duplicates_removed += 1;
        continue;
      }
    }

    if filters.dedupe_fuzzy && !instruction_text.is_empty() {
      let hash = simhash(&instruction_text);
      let mut duplicate = false;
      let segments = [
        (hash & 0xFFFF) as u16,
        ((hash >> 16) & 0xFFFF) as u16,
        ((hash >> 32) & 0xFFFF) as u16,
        ((hash >> 48) & 0xFFFF) as u16,
      ];
      for segment in segments {
        if let Some(existing) = fuzzy_buckets.get(&segment) {
          if existing
            .iter()
            .any(|candidate| hamming_distance(*candidate, hash) <= 3)
          {
            duplicate = true;
            break;
          }
        }
      }
      if duplicate {
        duplicates_removed += 1;
        continue;
      }
      for segment in segments {
        fuzzy_buckets.entry(segment).or_default().push(hash);
      }
    }

    filtered_ids.push(idx);
    if idx % 1000 == 0 {
      on_progress(idx, store.record_count);
    }
  }

  let summary = FilterSummary {
    total_count: store.record_count,
    filtered_count: filtered_ids.len(),
    duplicates_removed,
  };
  Ok((filtered_ids, summary))
}

pub fn collect_categories(store: &DatasetStore, field: &str) -> Result<Vec<CategoryCount>, String> {
  let file = File::open(&store.store_path).map_err(|e| e.to_string())?;
  let reader = BufReader::new(file);
  let mut counts: HashMap<String, usize> = HashMap::new();
  for line in reader.lines() {
    let line = line.map_err(|e| e.to_string())?;
    if line.trim().is_empty() {
      continue;
    }
    let record: Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
    if let Some(value) = record.get(field) {
      let key = value_to_string(value);
      *counts.entry(key).or_insert(0) += 1;
    }
  }
  let mut list = counts
    .into_iter()
    .map(|(name, count)| CategoryCount { name, count })
    .collect::<Vec<_>>();
  list.sort_by(|a, b| b.count.cmp(&a.count));
  Ok(list)
}
