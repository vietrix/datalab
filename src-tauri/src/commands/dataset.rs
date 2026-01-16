use std::sync::atomic::Ordering;
use std::path::PathBuf;

use tauri::{AppHandle, State};

use datalab_backend::io::{
  export_dataset as export_dataset_file,
  ingest_dataset,
  read_record_value,
};
use datalab_backend::models::{DatasetSummary, PreviewItem, PreviewPage};
use datalab_backend::records::build_preview_fields;
use datalab_backend::state::{AppState, DatasetStore, InnerState};

use crate::tauri_support::{dataset_dir, emit_progress, log_event};

fn resolve_view_ids(
  inner: &InnerState,
  store: &DatasetStore,
  view: &str,
  page: usize,
  page_size: usize,
) -> (Vec<usize>, usize) {
  let offset = page.saturating_sub(1) * page_size;
  match view {
    "filtered" => {
      if let Some(filtered) = &inner.filtered_ids {
        let total = filtered.len();
        let slice = filtered
          .iter()
          .skip(offset)
          .take(page_size)
          .cloned()
          .collect();
        (slice, total)
      } else {
        let total = store.record_count;
        let slice = (offset..(offset + page_size).min(total)).collect();
        (slice, total)
      }
    }
    "selected" => {
      if let Some(selected) = &inner.selected_ids {
        let total = selected.len();
        let slice = selected
          .iter()
          .skip(offset)
          .take(page_size)
          .cloned()
          .collect();
        (slice, total)
      } else {
        (Vec::new(), 0)
      }
    }
    "removed" => {
      if let Some(removed) = &inner.removed_ids {
        let total = removed.len();
        let slice = removed
          .iter()
          .skip(offset)
          .take(page_size)
          .cloned()
          .collect();
        (slice, total)
      } else {
        (Vec::new(), 0)
      }
    }
    _ => {
      let total = store.record_count;
      let slice = (offset..(offset + page_size).min(total)).collect();
      (slice, total)
    }
  }
}

#[tauri::command]
pub async fn import_dataset(
  path: String,
  app: AppHandle,
  state: State<'_, AppState>,
) -> Result<DatasetSummary, String> {
  state.cancel.store(false, Ordering::SeqCst);
  let cancel = state.cancel.clone();
  let handle = app.clone();
  let path_buf = std::path::PathBuf::from(&path);
  let store_dir = dataset_dir(&app)?;

  let dataset = tauri::async_runtime::spawn_blocking(move || {
    ingest_dataset(&path_buf, &store_dir, cancel.as_ref(), |count, _| {
      emit_progress(
        &handle,
        "import",
        count,
        0,
        &format!("Imported {count} records"),
      );
    })
  })
  .await
  .map_err(|e| e.to_string())??;

  log_event(&app, &format!("Imported dataset from {}", path));
  emit_progress(
    &app,
    "import",
    dataset.record_count,
    dataset.record_count,
    "Import complete",
  );

  let summary = DatasetSummary {
    id: dataset.id.clone(),
    source_path: dataset.source_path.to_string_lossy().to_string(),
    format: dataset.format.clone(),
    record_count: dataset.record_count,
    fields: dataset.fields.clone(),
    size_bytes: dataset.size_bytes,
  };

  let mut inner = state.inner.write().map_err(|_| "State lock error".to_string())?;
  inner.dataset = Some(dataset);
  inner.filtered_ids = None;
  inner.selected_ids = None;
  inner.removed_ids = None;
  inner.manual_include.clear();
  inner.manual_exclude.clear();

  Ok(summary)
}

#[tauri::command]
pub fn get_preview(
  view: String,
  page: usize,
  page_size: usize,
  state: State<'_, AppState>,
) -> Result<PreviewPage, String> {
  let inner = state.inner.read().map_err(|_| "State lock error".to_string())?;
  let store = inner
    .dataset
    .as_ref()
    .ok_or_else(|| "No dataset loaded".to_string())?;
  let (ids, total) = resolve_view_ids(&inner, store, &view, page, page_size);
  let mut items = Vec::new();
  for id in ids {
    let record = read_record_value(store, id)?;
    let fields = build_preview_fields(&record, &inner.field_map);
    items.push(PreviewItem { id, fields });
  }
  Ok(PreviewPage {
    items,
    total_count: total,
    page,
    page_size,
  })
}

#[tauri::command]
pub fn get_record(id: usize, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
  let inner = state.inner.read().map_err(|_| "State lock error".to_string())?;
  let store = inner
    .dataset
    .as_ref()
    .ok_or_else(|| "No dataset loaded".to_string())?;
  read_record_value(store, id)
}

#[tauri::command]
pub async fn export_dataset(
  view: String,
  path: String,
  format: String,
  app: AppHandle,
  state: State<'_, AppState>,
) -> Result<(), String> {
  state.cancel.store(false, Ordering::SeqCst);
  let cancel = state.cancel.clone();
  let handle = app.clone();
  let path_clone = PathBuf::from(path.clone());
  let format_clone = format.clone();
  let store = {
    let inner = state.inner.read().map_err(|_| "State lock error".to_string())?;
    inner
      .dataset
      .clone()
      .ok_or_else(|| "No dataset loaded".to_string())?
  };
  let ids = {
    let inner = state.inner.read().map_err(|_| "State lock error".to_string())?;
    match view.as_str() {
      "removed" => inner.removed_ids.clone().unwrap_or_default(),
      "selected" => inner.selected_ids.clone().unwrap_or_default(),
      "filtered" => inner.filtered_ids.clone().unwrap_or_default(),
      _ => (0..store.record_count).collect(),
    }
  };

  tauri::async_runtime::spawn_blocking(move || {
    export_dataset_file(
      &store,
      &ids,
      &path_clone,
      &format_clone,
      cancel.as_ref(),
      |current, total| {
        emit_progress(
          &handle,
          "export",
          current,
          total,
          &format!("Exported {current} records"),
        );
      },
    )
  })
  .await
  .map_err(|e| e.to_string())??;

  log_event(&app, &format!("Exported dataset to {path}"));
  Ok(())
}
