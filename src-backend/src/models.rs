use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldMap {
  pub instruction: Option<String>,
  pub output: Option<String>,
  pub code: Option<String>,
  pub category: Option<String>,
  pub score: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterConfig {
  pub require_fields: Vec<String>,
  pub min_length: Option<u32>,
  pub max_length: Option<u32>,
  pub include_keywords: Vec<String>,
  pub exclude_keywords: Vec<String>,
  pub category_field: Option<String>,
  pub categories: Vec<String>,
  pub dedupe_exact: bool,
  pub dedupe_fuzzy: bool,
  pub length_scope: String,
  pub keyword_case_sensitive: bool,
}

impl Default for FilterConfig {
  fn default() -> Self {
    Self {
      require_fields: Vec::new(),
      min_length: None,
      max_length: None,
      include_keywords: Vec::new(),
      exclude_keywords: Vec::new(),
      category_field: None,
      categories: Vec::new(),
      dedupe_exact: true,
      dedupe_fuzzy: false,
      length_scope: "instruction".to_string(),
      keyword_case_sensitive: false,
    }
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DistillConfig {
  pub target_count: Option<u32>,
  pub target_percent: Option<f32>,
  pub strategy: String,
  pub random_seed: Option<u64>,
  pub preserve_category_balance: bool,
}

impl Default for DistillConfig {
  fn default() -> Self {
    Self {
      target_count: None,
      target_percent: Some(10.0),
      strategy: "diversity".to_string(),
      random_seed: None,
      preserve_category_balance: false,
    }
  }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatasetSummary {
  pub id: String,
  pub source_path: String,
  pub format: String,
  pub record_count: usize,
  pub fields: Vec<String>,
  pub size_bytes: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterSummary {
  pub total_count: usize,
  pub filtered_count: usize,
  pub duplicates_removed: usize,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DistillSummary {
  pub total_count: usize,
  pub selected_count: usize,
  pub removed_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewPage {
  pub items: Vec<PreviewItem>,
  pub total_count: usize,
  pub page: usize,
  pub page_size: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewItem {
  pub id: usize,
  pub fields: Vec<PreviewField>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewField {
  pub name: String,
  pub value: String,
  pub kind: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualChange {
  pub id: usize,
  pub include: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryCount {
  pub name: String,
  pub count: usize,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
  pub last_path: Option<String>,
  pub language: Option<String>,
  pub field_map: FieldMap,
  pub filters: FilterConfig,
  pub distill: DistillConfig,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProgressPayload {
  pub stage: String,
  pub current: usize,
  pub total: usize,
  pub message: Option<String>,
}
