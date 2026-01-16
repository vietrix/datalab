import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";

import type {
  CategoryCount,
  DistillConfig,
  DistillSummary,
  FieldMap,
  FilterConfig,
  FilterSummary,
  ManualChange,
  PreviewPage,
  ProgressEvent,
  Settings,
  DatasetSummary,
  ViewMode
} from "./types";

export async function selectDatasetFile() {
  return open({
    multiple: false,
    filters: [
      { name: "Datasets", extensions: ["json", "jsonl", "csv"] },
      { name: "JSON", extensions: ["json", "jsonl"] },
      { name: "CSV", extensions: ["csv"] }
    ]
  });
}

export async function selectExportPath(defaultName: string) {
  return save({
    defaultPath: defaultName,
    filters: [
      { name: "JSON", extensions: ["json"] },
      { name: "CSV", extensions: ["csv"] }
    ]
  });
}

export async function importDataset(path: string): Promise<DatasetSummary> {
  return invoke("import_dataset", { path });
}

export async function getPreview(
  view: ViewMode,
  page: number,
  pageSize: number
): Promise<PreviewPage> {
  return invoke("get_preview", { view, page, pageSize });
}

export async function getRecord(id: number) {
  return invoke("get_record", { id });
}

export async function applyFilters(
  filters: FilterConfig,
  fieldMap: FieldMap
): Promise<FilterSummary> {
  return invoke("apply_filters", { filters, fieldMap });
}

export async function setFieldMap(fieldMap: FieldMap): Promise<void> {
  return invoke("set_field_map", { fieldMap });
}

export async function listCategories(field: string): Promise<CategoryCount[]> {
  return invoke("list_categories", { field });
}

export async function previewDistillation(
  config: DistillConfig,
  fieldMap: FieldMap
): Promise<DistillSummary> {
  return invoke("preview_distillation", { config, fieldMap });
}

export async function updateManualSelection(
  changes: ManualChange[]
): Promise<DistillSummary> {
  return invoke("update_manual_selection", { changes });
}

export async function exportDataset(
  view: ViewMode,
  path: string,
  format: "json" | "csv"
) {
  return invoke("export_dataset", { view, path, format });
}

export async function cancelTask() {
  return invoke("cancel_task");
}

export async function loadSettings(): Promise<Settings | null> {
  return invoke("load_settings");
}

export async function saveSettings(settings: Settings): Promise<void> {
  return invoke("save_settings", { settings });
}

export async function getLogs(limit = 200): Promise<string[]> {
  return invoke("get_logs", { limit });
}

export async function listenProgress(
  handler: (event: ProgressEvent) => void
) {
  return listen<ProgressEvent>("progress", (event) => handler(event.payload));
}
