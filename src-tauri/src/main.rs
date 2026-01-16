mod commands;
mod tauri_support;

use datalab_backend::state::AppState;

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_process::init())
    .setup(|app| {
      #[cfg(desktop)]
      app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
      Ok(())
    })
    .manage(AppState::default())
    .invoke_handler(tauri::generate_handler![
      commands::dataset::import_dataset,
      commands::dataset::get_preview,
      commands::dataset::get_record,
      commands::dataset::export_dataset,
      commands::filters::apply_filters,
      commands::filters::list_categories,
      commands::filters::set_field_map,
      commands::distill::preview_distillation,
      commands::distill::update_manual_selection,
      commands::settings::cancel_task,
      commands::settings::load_settings,
      commands::settings::save_settings,
      commands::settings::get_logs
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
