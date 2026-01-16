use tauri::{App, AppHandle, Emitter};
use tauri::menu::{MenuBuilder, SubmenuBuilder};

fn datalab_emit_menu_action(handle: &AppHandle, action: &str) {
  let _ = handle.emit("menu-action", action);
}

pub fn datalab_menu_setup(app: &App) -> tauri::Result<()> {
  let app_menu = SubmenuBuilder::new(app, "DataLab")
    .text("app_about", "About DataLab (by Vietrix)")
    .text("app_check_updates", "Check for Updates")
    .text("app_quit", "Quit DataLab")
    .build()?;

  let file_menu = SubmenuBuilder::new(app, "File")
    .text("file_import", "Import Dataset...")
    .text("file_export_selected", "Export Selected...")
    .text("file_export_removed", "Export Removed...")
    .build()?;

  let view_menu = SubmenuBuilder::new(app, "View")
    .text("view_prev_step", "Previous Step")
    .text("view_next_step", "Next Step")
    .text("view_toggle_menu", "Toggle Side Menu")
    .build()?;

  let language_menu = SubmenuBuilder::new(app, "Language")
    .text("lang_en", "English")
    .text("lang_vi", "Tiếng Việt")
    .build()?;

  let help_menu = SubmenuBuilder::new(app, "Help")
    .text("help_updates", "Check for Updates")
    .text("help_help", "Help")
    .text("help_logs", "Logs")
    .build()?;

  let menu = MenuBuilder::new(app)
    .items(&[&app_menu, &file_menu, &view_menu, &language_menu, &help_menu])
    .build()?;
  app.set_menu(menu)?;

  app.on_menu_event(move |app_handle, event| {
    match event.id().0.as_str() {
      "app_quit" => {
        app_handle.exit(0);
      }
      "file_import" => datalab_emit_menu_action(app_handle, "import"),
      "file_export_selected" => datalab_emit_menu_action(app_handle, "export-selected"),
      "file_export_removed" => datalab_emit_menu_action(app_handle, "export-removed"),
      "view_prev_step" => datalab_emit_menu_action(app_handle, "prev-step"),
      "view_next_step" => datalab_emit_menu_action(app_handle, "next-step"),
      "view_toggle_menu" => datalab_emit_menu_action(app_handle, "toggle-menu"),
      "lang_en" => datalab_emit_menu_action(app_handle, "language-en"),
      "lang_vi" => datalab_emit_menu_action(app_handle, "language-vi"),
      "help_updates" | "app_check_updates" => {
        datalab_emit_menu_action(app_handle, "check-updates")
      }
      "help_logs" => datalab_emit_menu_action(app_handle, "open-logs"),
      "help_help" | "app_about" => datalab_emit_menu_action(app_handle, "open-help"),
      _ => {}
    }
  });

  Ok(())
}
