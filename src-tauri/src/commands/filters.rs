use std::sync::atomic::Ordering;

use tauri::{AppHandle, State};

use datalab_backend::filters::{apply_filters_inner, collect_categories};
use datalab_backend::models::{CategoryCount, FieldMap, FilterConfig, FilterSummary};
use datalab_backend::state::AppState;

use crate::tauri_support::{emit_progress, log_event};

#[tauri::command]
pub async fn apply_filters(
  filters: FilterConfig,
  field_map: FieldMap,
  app: AppHandle,
  state: State<'_, AppState>,
) -> Result<FilterSummary, String> {
  state.cancel.store(false, Ordering::SeqCst);
  let cancel = state.cancel.clone();
  let handle = app.clone();
  let filters_clone = filters.clone();
  let field_map_clone = field_map.clone();
  let store = {
    let inner = state.inner.read().map_err(|_| "State lock error".to_string())?;
    inner
      .dataset
      .clone()
      .ok_or_else(|| "No dataset loaded".to_string())?
  };

  let (filtered_ids, summary) = tauri::async_runtime::spawn_blocking(move || {
    apply_filters_inner(&store, &filters_clone, &field_map_clone, cancel.as_ref(), |current, total| {
      emit_progress(
        &handle,
        "filter",
        current,
        total,
        &format!("Filtered {current} records"),
      );
    })
  })
  .await
  .map_err(|e| e.to_string())??;

  log_event(
    &app,
    &format!("Applied filters, {} records retained", summary.filtered_count),
  );

  let mut inner = state.inner.write().map_err(|_| "State lock error".to_string())?;
  inner.filters = filters;
  inner.field_map = field_map;
  inner.filtered_ids = Some(filtered_ids);
  inner.selected_ids = None;
  inner.removed_ids = None;
  inner.manual_include.clear();
  inner.manual_exclude.clear();

  Ok(summary)
}

#[tauri::command]
pub fn list_categories(field: String, state: State<'_, AppState>) -> Result<Vec<CategoryCount>, String> {
  let inner = state.inner.read().map_err(|_| "State lock error".to_string())?;
  let store = inner
    .dataset
    .as_ref()
    .ok_or_else(|| "No dataset loaded".to_string())?;
  collect_categories(store, &field)
}

#[tauri::command]
pub fn set_field_map(field_map: FieldMap, state: State<'_, AppState>) -> Result<(), String> {
  let mut inner = state.inner.write().map_err(|_| "State lock error".to_string())?;
  inner.field_map = field_map;
  Ok(())
}
