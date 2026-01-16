use std::fs;
use std::io::{BufRead, BufReader};
use std::sync::atomic::Ordering;

use tauri::{AppHandle, State};

use datalab_backend::models::Settings;
use datalab_backend::state::AppState;

use crate::tauri_support::{log_file_path, settings_path};

#[tauri::command]
pub fn cancel_task(state: State<'_, AppState>) -> Result<(), String> {
  state.cancel.store(true, Ordering::SeqCst);
  Ok(())
}

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Result<Option<Settings>, String> {
  let settings_path = settings_path(&app)?;
  if !settings_path.exists() {
    return Ok(None);
  }
  let content = fs::read_to_string(settings_path).map_err(|e| e.to_string())?;
  let settings = serde_json::from_str(&content).map_err(|e| e.to_string())?;
  Ok(Some(settings))
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
  let settings_path = settings_path(&app)?;
  let content = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
  fs::write(settings_path, content).map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
pub fn get_logs(app: AppHandle, limit: usize) -> Result<Vec<String>, String> {
  let log_path = log_file_path(&app)?;
  if !log_path.exists() {
    return Ok(Vec::new());
  }
  let file = fs::File::open(log_path).map_err(|e| e.to_string())?;
  let reader = BufReader::new(file);
  let lines = reader
    .lines()
    .filter_map(Result::ok)
    .collect::<Vec<_>>();
  let start = lines.len().saturating_sub(limit);
  Ok(lines[start..].to_vec())
}
