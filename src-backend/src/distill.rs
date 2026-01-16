use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::sync::atomic::{AtomicBool, Ordering};

use rand::rngs::StdRng;
use rand::seq::SliceRandom;
use rand::SeedableRng;
use serde_json::Value;

use crate::models::{DistillConfig, DistillSummary, FieldMap};
use crate::records::{extract_text_value, simhash};
use crate::state::DatasetStore;

#[derive(Debug, Clone)]
pub struct RecordMeta {
  pub id: usize,
  pub category: Option<String>,
  pub score: f64,
  pub signature: u64,
}

pub fn build_record_meta(
  record: &Value,
  id: usize,
  field_map: &FieldMap,
  strategy: &str,
) -> RecordMeta {
  let category = extract_text_value(record, &field_map.category);
  let score = extract_text_value(record, &field_map.score)
    .and_then(|value| value.parse::<f64>().ok())
    .unwrap_or(0.0);
  let signature = if strategy == "diversity" {
    let text = extract_text_value(record, &field_map.instruction).unwrap_or_default();
    simhash(&text)
  } else {
    0u64
  };
  RecordMeta {
    id,
    category,
    score,
    signature,
  }
}

fn diversity_select(metas: &[RecordMeta], target: usize, rng: &mut StdRng) -> Vec<usize> {
  let mut buckets: HashMap<u16, Vec<&RecordMeta>> = HashMap::new();
  for meta in metas {
    let bucket = (meta.signature >> 52) as u16;
    buckets.entry(bucket).or_default().push(meta);
  }
  for list in buckets.values_mut() {
    list.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    list.shuffle(rng);
  }

  let mut selected = Vec::new();
  let mut bucket_keys: Vec<u16> = buckets.keys().cloned().collect();
  bucket_keys.shuffle(rng);

  while selected.len() < target {
    let mut progressed = false;
    for key in &bucket_keys {
      if let Some(list) = buckets.get_mut(key) {
        if let Some(meta) = list.pop() {
          selected.push(meta.id);
          progressed = true;
          if selected.len() >= target {
            break;
          }
        }
      }
    }
    if !progressed {
      break;
    }
  }
  selected
}

fn apply_strategy(metas: &[RecordMeta], target: usize, config: &DistillConfig) -> Vec<usize> {
  let seed = config.random_seed.unwrap_or(42);
  let mut rng = StdRng::seed_from_u64(seed);
  let mut selected = match config.strategy.as_str() {
    "importance" => {
      let mut sorted = metas.to_vec();
      sorted.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
      sorted.iter().take(target).map(|meta| meta.id).collect()
    }
    "random" => {
      let mut ids = metas.iter().map(|meta| meta.id).collect::<Vec<_>>();
      ids.shuffle(&mut rng);
      ids.truncate(target);
      ids
    }
    _ => diversity_select(metas, target, &mut rng),
  };
  selected.sort_unstable();
  selected
}

pub fn select_records(metas: &[RecordMeta], config: &DistillConfig) -> Vec<usize> {
  let total = metas.len();
  if total == 0 {
    return Vec::new();
  }
  let target = if let Some(count) = config.target_count {
    count as usize
  } else if let Some(percent) = config.target_percent {
    ((percent / 100.0) * total as f32).round() as usize
  } else {
    ((0.1 * total as f32).round()) as usize
  }
  .clamp(1, total);

  if config.preserve_category_balance {
    let mut by_category: HashMap<String, Vec<RecordMeta>> = HashMap::new();
    for meta in metas {
      let key = meta
        .category
        .clone()
        .unwrap_or_else(|| "uncategorized".to_string());
      by_category.entry(key).or_default().push(meta.clone());
    }

    let mut allocations: Vec<(String, usize, usize)> = by_category
      .iter()
      .map(|(name, items)| {
        let count = items.len();
        let alloc = ((count as f32 / total as f32) * target as f32).round() as usize;
        (name.clone(), count, alloc)
      })
      .collect();

    let mut allocated = allocations.iter().map(|item| item.2).sum::<usize>();
    allocations.sort_by(|a, b| b.1.cmp(&a.1));
    let mut idx = 0;
    while allocated < target {
      allocations[idx].2 += 1;
      allocated += 1;
      idx = (idx + 1) % allocations.len();
    }

    let mut selected = Vec::new();
    for (name, _, alloc) in allocations {
      if let Some(bucket) = by_category.get(&name) {
        let bucket_selected = apply_strategy(bucket, alloc.min(bucket.len()), config);
        selected.extend(bucket_selected);
      }
    }
    selected.sort_unstable();
    selected.truncate(target);
    selected
  } else {
    apply_strategy(metas, target, config)
  }
}

pub fn preview_distillation(
  store: &DatasetStore,
  base_ids: Option<&[usize]>,
  config: &DistillConfig,
  field_map: &FieldMap,
  cancel: &AtomicBool,
  mut on_progress: impl FnMut(usize, usize),
) -> Result<(Vec<usize>, Vec<usize>, DistillSummary), String> {
  let base_ids: Vec<usize> = if let Some(list) = base_ids {
    list.to_vec()
  } else {
    (0..store.record_count).collect()
  };
  let base_set: HashSet<usize> = base_ids.iter().cloned().collect();

  let file = File::open(&store.store_path).map_err(|e| e.to_string())?;
  let reader = BufReader::new(file);
  let mut metas = Vec::new();
  for (idx, line) in reader.lines().enumerate() {
    if cancel.load(Ordering::SeqCst) {
      return Err("Distillation canceled".to_string());
    }
    if !base_set.contains(&idx) {
      continue;
    }
    let line = line.map_err(|e| e.to_string())?;
    let record: Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
    metas.push(build_record_meta(&record, idx, field_map, &config.strategy));
    if metas.len() % 1000 == 0 {
      on_progress(metas.len(), base_set.len());
    }
  }

  let mut selected = select_records(&metas, config);
  selected.sort_unstable();
  let selected_set: HashSet<usize> = selected.iter().cloned().collect();
  let mut removed = base_ids
    .iter()
    .filter(|id| !selected_set.contains(id))
    .cloned()
    .collect::<Vec<_>>();
  removed.sort_unstable();

  let summary = DistillSummary {
    total_count: base_ids.len(),
    selected_count: selected.len(),
    removed_count: removed.len(),
  };
  Ok((selected, removed, summary))
}
