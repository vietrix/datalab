use std::collections::HashSet;
use std::sync::atomic::Ordering;

use tauri::{AppHandle, State};

use datalab_backend::distill::preview_distillation as preview_distillation_inner;
use datalab_backend::models::{DistillConfig, DistillSummary, FieldMap, ManualChange};
use datalab_backend::state::AppState;

use crate::tauri_support::{emit_progress, log_event};

#[tauri::command]
pub async fn preview_distillation(
  config: DistillConfig,
  field_map: FieldMap,
  app: AppHandle,
  state: State<'_, AppState>,
) -> Result<DistillSummary, String> {
  state.cancel.store(false, Ordering::SeqCst);
  let cancel = state.cancel.clone();
  let handle = app.clone();
  let config_clone = config.clone();
  let field_map_clone = field_map.clone();
  let store = {
    let inner = state.inner.read().map_err(|_| "State lock error".to_string())?;
    inner
      .dataset
      .clone()
      .ok_or_else(|| "No dataset loaded".to_string())?
  };
  let filtered_ids = {
    let inner = state.inner.read().map_err(|_| "State lock error".to_string())?;
    inner.filtered_ids.clone()
  };

  let (selected_ids, removed_ids, summary) = tauri::async_runtime::spawn_blocking(move || {
    preview_distillation_inner(
      &store,
      filtered_ids.as_deref(),
      &config_clone,
      &field_map_clone,
      cancel.as_ref(),
      |current, total| {
        emit_progress(
          &handle,
          "distill",
          current,
          total,
          &format!("Prepared {current} records"),
        );
      },
    )
  })
  .await
  .map_err(|e| e.to_string())??;

  log_event(
    &app,
    &format!("Previewed distillation, {} selected", summary.selected_count),
  );

  let mut inner = state.inner.write().map_err(|_| "State lock error".to_string())?;
  inner.distill_config = config;
  inner.field_map = field_map;
  inner.selected_ids = Some(selected_ids);
  inner.removed_ids = Some(removed_ids);
  inner.manual_include.clear();
  inner.manual_exclude.clear();

  Ok(summary)
}

#[tauri::command]
pub fn update_manual_selection(
  changes: Vec<ManualChange>,
  state: State<'_, AppState>,
) -> Result<DistillSummary, String> {
  let mut inner = state.inner.write().map_err(|_| "State lock error".to_string())?;
  let selected_ids = inner
    .selected_ids
    .take()
    .ok_or_else(|| "No distillation preview available".to_string())?;
  let removed_ids = inner
    .removed_ids
    .take()
    .ok_or_else(|| "No distillation preview available".to_string())?;

  let mut selected_set: HashSet<usize> = selected_ids.into_iter().collect();
  let mut removed_set: HashSet<usize> = removed_ids.into_iter().collect();

  for change in changes {
    if change.include {
      selected_set.insert(change.id);
      removed_set.remove(&change.id);
    } else {
      selected_set.remove(&change.id);
      removed_set.insert(change.id);
    }
  }

  let mut selected_vec = selected_set.into_iter().collect::<Vec<_>>();
  let mut removed_vec = removed_set.into_iter().collect::<Vec<_>>();
  selected_vec.sort_unstable();
  removed_vec.sort_unstable();

  let total_count = selected_vec.len() + removed_vec.len();
  let summary = DistillSummary {
    total_count,
    selected_count: selected_vec.len(),
    removed_count: removed_vec.len(),
  };

  inner.selected_ids = Some(selected_vec);
  inner.removed_ids = Some(removed_vec);

  Ok(summary)
}
