use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, RwLock};

use crate::models::{DistillConfig, FieldMap, FilterConfig};

#[derive(Debug, Clone)]
pub struct DatasetStore {
  pub id: String,
  pub source_path: PathBuf,
  pub store_path: PathBuf,
  pub offsets: Vec<u64>,
  pub fields: Vec<String>,
  pub record_count: usize,
  pub size_bytes: u64,
  pub format: String,
}

#[derive(Debug, Default)]
pub struct InnerState {
  pub dataset: Option<DatasetStore>,
  pub field_map: FieldMap,
  pub filters: FilterConfig,
  pub distill_config: DistillConfig,
  pub filtered_ids: Option<Vec<usize>>,
  pub selected_ids: Option<Vec<usize>>,
  pub removed_ids: Option<Vec<usize>>,
  pub manual_include: HashSet<usize>,
  pub manual_exclude: HashSet<usize>,
}

#[derive(Debug)]
pub struct AppState {
  pub inner: RwLock<InnerState>,
  pub cancel: Arc<AtomicBool>,
}

impl Default for AppState {
  fn default() -> Self {
    Self {
      inner: RwLock::new(InnerState::default()),
      cancel: Arc::new(AtomicBool::new(false)),
    }
  }
}
