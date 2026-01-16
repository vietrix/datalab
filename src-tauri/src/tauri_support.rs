use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

use chrono::Utc;
use tauri::{AppHandle, Emitter, Manager};

use datalab_backend::models::ProgressPayload;

pub struct AppPaths {
  pub datasets: PathBuf,
  pub settings: PathBuf,
  pub log_file: PathBuf,
}

fn app_paths(handle: &AppHandle) -> Result<AppPaths, String> {
  let root = handle
    .path()
    .app_data_dir()
    .map_err(|e| format!("Unable to resolve app data dir: {e}"))?;
  let datasets = root.join("datasets");
  let logs = root.join("logs");
  fs::create_dir_all(&datasets).map_err(|e| e.to_string())?;
  fs::create_dir_all(&logs).map_err(|e| e.to_string())?;
  let settings = root.join("settings.json");
  let log_file = logs.join("datalab.log");
  Ok(AppPaths {
    datasets,
    settings,
    log_file,
  })
}

pub fn dataset_dir(handle: &AppHandle) -> Result<PathBuf, String> {
  Ok(app_paths(handle)?.datasets)
}

pub fn settings_path(handle: &AppHandle) -> Result<PathBuf, String> {
  Ok(app_paths(handle)?.settings)
}

pub fn log_file_path(handle: &AppHandle) -> Result<PathBuf, String> {
  Ok(app_paths(handle)?.log_file)
}

pub fn log_event(handle: &AppHandle, message: &str) {
  if let Ok(paths) = app_paths(handle) {
    let timestamp = Utc::now().to_rfc3339();
    if let Ok(mut file) = OpenOptions::new()
      .create(true)
      .append(true)
      .open(paths.log_file)
    {
      let _ = writeln!(file, "[{timestamp}] {message}");
    }
  }
}

pub fn emit_progress(handle: &AppHandle, stage: &str, current: usize, total: usize, message: &str) {
  let payload = ProgressPayload {
    stage: stage.to_string(),
    current,
    total,
    message: Some(message.to_string()),
  };
  let _ = handle.emit("progress", payload);
}
