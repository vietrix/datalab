import { LitElement, html, nothing, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { customElement, state } from "lit/decorators.js";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import javascript from "highlight.js/lib/languages/javascript";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import typescript from "highlight.js/lib/languages/typescript";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

import {
  applyFilters,
  cancelTask,
  exportDataset,
  getLogs,
  getPreview,
  getRecord,
  importDataset,
  listenMenuAction,
  listenProgress,
  listCategories,
  loadSettings,
  previewDistillation,
  saveSettings,
  selectDatasetFile,
  selectExportPath,
  setFieldMap,
  updateManualSelection
} from "./lib/api";
import type {
  CategoryCount,
  DatasetSummary,
  DistillConfig,
  DistillSummary,
  FieldMap,
  FilterConfig,
  FilterSummary,
  MenuAction,
  PreviewPage,
  ProgressEvent,
  ViewMode
} from "./lib/types";
import { resolveLanguage, translate, type Language } from "./i18n";

hljs.registerLanguage("json", json);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("bash", bash);

type UpdateHandle = Awaited<ReturnType<typeof check>>;

type RecordPayload = {
  id: number;
  record: unknown;
  language?: string;
};

const defaultFilters: FilterConfig = {
  requireFields: [],
  includeKeywords: [],
  excludeKeywords: [],
  categories: [],
  dedupeExact: true,
  dedupeFuzzy: false,
  lengthScope: "instruction",
  keywordCaseSensitive: false
};

const defaultDistill: DistillConfig = {
  targetPercent: 10,
  strategy: "diversity",
  preserveCategoryBalance: false
};

@customElement("app-root")
export class AppRoot extends LitElement {
  @state() private step = 0;
  @state() private language: Language = "en";
  @state() private booting = true;
  @state() private recordViewOnly = false;
  @state() private recordError = "";
  @state() private bootSteps: string[] = [];
  @state() private bootLogs: string[] = [];
  @state() private menuCollapsed = false;
  @state() private dataset: DatasetSummary | null = null;
  @state() private preview: PreviewPage | null = null;
  @state() private previewView: ViewMode = "all";
  @state() private page = 1;
  @state() private pageSize = 20;
  @state() private fieldMap: FieldMap = {};
  @state() private filters: FilterConfig = { ...defaultFilters };
  @state() private filterSummary: FilterSummary | null = null;
  @state() private distillConfig: DistillConfig = { ...defaultDistill };
  @state() private distillSummary: DistillSummary | null = null;
  @state() private progress: ProgressEvent | null = null;
  @state() private busy = false;
  @state() private errorMessage = "";
  @state() private recordDetail: { id: number; record: unknown } | null = null;
  @state() private showHelp = false;
  @state() private showLogs = false;
  @state() private logEntries: string[] = [];
  @state() private categorySuggestions: CategoryCount[] = [];
  @state() private showUpdateDialog = false;
  @state() private updateStatus:
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "ready"
    | "none"
    | "error" = "idle";
  @state() private updateError = "";
  @state() private updateProgress = 0;
  @state() private updateInfo: {
    version: string;
    currentVersion: string;
    date?: string | null;
    body?: string | null;
  } | null = null;
  private updateHandle: UpdateHandle | null = null;
  private recordUnlisten: (() => void) | null = null;
  private menuUnlisten: (() => void) | null = null;

  protected createRenderRoot() {
    return this;
  }

  async connectedCallback() {
    super.connectedCallback();
    const params = new URLSearchParams(window.location.search);
    this.recordViewOnly = params.get("view") === "record";
    if (this.recordViewOnly) {
      this.booting = false;
      this.language = resolveLanguage(
        navigator.language.toLowerCase().startsWith("vi") ? "vi" : "en"
      );
      await this.loadRecordFromQuery(params);
      await this.bindRecordListener();
      return;
    }
    await this.bindMenuListener();
    await this.bootstrap();
  }

  async bootstrap() {
    const fallbackTimer = setTimeout(() => {
      this.booting = false;
    }, 8000);
    const browserLang = navigator.language.toLowerCase().startsWith("vi") ? "vi" : "en";
    this.language = resolveLanguage(browserLang);
    this.booting = true;
    this.bootSteps = [];

    try {
      try {
        const progressListener = listenProgress((event) => {
          this.progress = event;
        });
        progressListener.catch((error) => {
          this.errorMessage = this.t("error.bootstrap", {
            message: error instanceof Error ? error.message : String(error)
          });
        });
      } catch (error) {
        this.errorMessage = this.t("error.bootstrap", {
          message: error instanceof Error ? error.message : String(error)
        });
      }
      this.pushBootStep("splash.step.translations");
      const settings = await this.runBootstrapStep(
        "splash.step.settings",
        () => loadSettings(),
        null
      );
      if (settings?.language) {
        this.language = resolveLanguage(settings.language);
      }
      if (settings) {
        this.fieldMap = settings.fieldMap ?? {};
        this.filters = { ...defaultFilters, ...settings.filters };
        this.distillConfig = { ...defaultDistill, ...settings.distill };
      }

      this.bootLogs = await this.runBootstrapStep(
        "splash.step.logs",
        () => getLogs(12),
        []
      );

      await this.runBootstrapStep(
        "splash.step.updates",
        async () => {
          await this.checkForUpdates(true);
          return true;
        },
        true
      );
    } catch (error) {
      this.errorMessage = this.t("error.bootstrap", {
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      this.pushBootStep("splash.step.ready");
      await new Promise((resolve) => setTimeout(resolve, 450));
      this.booting = false;
      clearTimeout(fallbackTimer);
      void this.autoInstallAvailableUpdate();
    }
  }

  private t(key: string, params?: Record<string, string | number>) {
    return translate(this.language, key, params);
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number, stepKey: string) {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(this.t("error.timeout", { step: this.t(stepKey) })));
      }, ms);
      promise
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  private async runBootstrapStep<T>(
    stepKey: string,
    task: () => Promise<T>,
    fallback: T,
    timeoutMs = 4000
  ) {
    this.pushBootStep(stepKey);
    try {
      return await this.withTimeout(task(), timeoutMs, stepKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.errorMessage = this.t("error.bootstrap", { message });
      return fallback;
    }
  }

  private pushBootStep(key: string) {
    this.bootSteps = [...this.bootSteps, key];
  }

  private get bootProgress() {
    const totalSteps = 5;
    return Math.min(1, this.bootSteps.length / totalSteps);
  }

  private get stepLabels() {
    return [
      this.t("step.import"),
      this.t("step.filter"),
      this.t("step.distill"),
      this.t("step.review")
    ];
  }

  private viewLabel(view: ViewMode) {
    return this.t(`view.${view}`);
  }

  private getSplitClass() {
    return this.menuCollapsed ? "split two menu-collapsed" : "split two";
  }

  private renderMenuPanel(
    title: string,
    subtitle: string,
    body: TemplateResult
  ) {
    const toggleLabel = this.menuCollapsed
      ? this.t("action.expandMenu")
      : this.t("action.collapseMenu");
    const toggleIcon = this.menuCollapsed ? ">>" : "<<";
    const collapsedStep = this.stepLabels[this.step] ?? "";
    return html`
      <section class="panel menu-panel ${this.menuCollapsed ? "collapsed" : ""}">
        <div class="menu-header">
          ${this.menuCollapsed
            ? nothing
            : html`<div class="menu-title-block">
                <div class="panel-title">${title}</div>
                <div class="panel-subtitle">${subtitle}</div>
              </div>`}
          <button
            type="button"
            class="menu-handle"
            @click=${() => (this.menuCollapsed = !this.menuCollapsed)}
          >
            <span class="menu-handle-icon">${toggleIcon}</span>
            <span class="menu-handle-label">${toggleLabel}</span>
          </button>
        </div>
        <div class="menu-body">
          ${this.menuCollapsed
            ? html`
                <div class="menu-collapsed">
                  <div class="menu-collapsed-title">${this.t("label.menu")}</div>
                  <div class="menu-collapsed-step">${collapsedStep}</div>
                </div>
              `
            : body}
        </div>
      </section>
    `;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.recordUnlisten) {
      this.recordUnlisten();
      this.recordUnlisten = null;
    }
    if (this.menuUnlisten) {
      this.menuUnlisten();
      this.menuUnlisten = null;
    }
  }

  private async bindMenuListener() {
    try {
      this.menuUnlisten = await listenMenuAction((action) => {
        void this.handleMenuAction(action);
      });
    } catch (error) {
      console.error(error);
    }
  }

  private async handleMenuAction(action: MenuAction) {
    switch (action) {
      case "import":
        await this.handleImport();
        break;
      case "export-selected":
        await this.handleExport("selected");
        break;
      case "export-removed":
        await this.handleExport("removed");
        break;
      case "toggle-menu":
        this.menuCollapsed = !this.menuCollapsed;
        break;
      case "check-updates":
        await this.checkForUpdates(false);
        break;
      case "open-logs":
        await this.loadLogs();
        break;
      case "open-help":
        this.showHelp = true;
        break;
      case "next-step":
        await this.changeStep(this.step + 1);
        break;
      case "prev-step":
        await this.changeStep(this.step - 1);
        break;
      case "language-en":
        await this.changeLanguage("en");
        break;
      case "language-vi":
        await this.changeLanguage("vi");
        break;
      default:
        break;
    }
  }

  private async bindRecordListener() {
    try {
      const currentWindow = getCurrentWindow();
      this.recordUnlisten = await currentWindow.listen<RecordPayload>(
        "record-data",
        async (event) => {
          const payload = event.payload;
          if (payload?.language) {
            this.language = resolveLanguage(payload.language);
          }
          if (payload) {
            this.recordError = "";
            this.recordDetail = { id: payload.id, record: payload.record };
            await this.updateRecordWindowTitle(payload.id);
          }
        }
      );
    } catch (error) {
      // Record-only window should stay functional even if listener fails.
      console.error(error);
    }
  }

  private async updateRecordWindowTitle(id: number) {
    try {
      await getCurrentWindow().setTitle(
        this.t("record.windowTitle", { id: id + 1 })
      );
    } catch (error) {
      console.error(error);
    }
  }

  private async loadRecordFromQuery(params: URLSearchParams) {
    const id = params.get("id");
    if (!id) {
      return;
    }
    const parsed = Number(id);
    if (!Number.isFinite(parsed)) {
      this.recordError = this.t("record.loadError");
      return;
    }
    const language = params.get("lang");
    if (language) {
      this.language = resolveLanguage(language);
    }
    try {
      const record = await getRecord(parsed);
      this.recordDetail = { id: parsed, record };
      this.recordError = "";
      await this.updateRecordWindowTitle(parsed);
    } catch (error) {
      this.recordError = error instanceof Error ? error.message : String(error);
    }
  }

  private async runTask<T>(task: () => Promise<T>) {
    this.errorMessage = "";
    this.busy = true;
    try {
      const result = await task();
      return result;
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
      this.progress = null;
    }
    return null;
  }

  private async handleImport() {
    const selection = await selectDatasetFile();
    if (!selection || typeof selection !== "string") {
      return;
    }

    await this.runTask(async () => {
      const summary = await importDataset(selection);
      this.dataset = summary;
      this.filterSummary = null;
      this.distillSummary = null;
      this.previewView = "all";
      this.page = 1;
      this.autoMapFields(summary.fields);
      await setFieldMap(this.fieldMap);
      await this.refreshPreview();
      await this.saveUserSettings();
    });
  }

  private autoMapFields(fields: string[]) {
    const lower = fields.map((field) => field.toLowerCase());
    const findField = (candidates: string[]) => {
      const index = lower.findIndex((field) =>
        candidates.some((candidate) => field.includes(candidate))
      );
      return index >= 0 ? fields[index] : undefined;
    };

    this.fieldMap = {
      instruction:
        this.fieldMap.instruction ?? findField(["instruction", "prompt", "input"]),
      output: this.fieldMap.output ?? findField(["output", "response", "answer"]),
      code: this.fieldMap.code ?? findField(["code", "solution"]),
      category: this.fieldMap.category ?? findField(["category", "lang", "type"]),
      score: this.fieldMap.score ?? findField(["score", "quality", "rating"])
    };
  }

  private async refreshPreview(view = this.previewView) {
    if (!this.dataset) {
      this.preview = null;
      return;
    }
    const page = Math.max(1, this.page);
    const preview = await getPreview(view, page, this.pageSize);
    this.preview = preview;
    this.previewView = view;
  }

  private async applyFilterConfig() {
    if (!this.dataset) {
      return;
    }
    await this.runTask(async () => {
      const summary = await applyFilters(this.filters, this.fieldMap);
      this.filterSummary = summary;
      this.previewView = "filtered";
      this.page = 1;
      await this.refreshPreview("filtered");
      await this.saveUserSettings();
      await this.loadCategorySuggestions();
    });
  }

  private async loadCategorySuggestions() {
    if (!this.fieldMap.category) {
      this.categorySuggestions = [];
      return;
    }
    const list = await listCategories(this.fieldMap.category);
    this.categorySuggestions = list;
  }

  private async runDistillationPreview() {
    if (!this.dataset) {
      return;
    }
    await this.runTask(async () => {
      const summary = await previewDistillation(this.distillConfig, this.fieldMap);
      this.distillSummary = summary;
      this.previewView = "selected";
      this.page = 1;
      await this.refreshPreview("selected");
      await this.saveUserSettings();
    });
  }

  private async handleManualToggle(id: number, include: boolean) {
    await this.runTask(async () => {
      const summary = await updateManualSelection([{ id, include }]);
      this.distillSummary = summary;
      await this.refreshPreview(this.previewView);
    });
  }

  private async handleExport(view: ViewMode) {
    if (!this.dataset || !this.distillSummary) {
      return;
    }
    const defaultName =
      view === "removed" ? "distilled_removed.json" : "distilled_dataset.json";
    const exportPath = await selectExportPath(defaultName);
    if (!exportPath || typeof exportPath !== "string") {
      return;
    }

    const format = exportPath.toLowerCase().endsWith(".csv") ? "csv" : "json";
    await this.runTask(async () => {
      await exportDataset(view, exportPath, format);
    });
  }

  private async showRecord(id: number) {
    const record = await getRecord(id);
    await this.openRecordWindow({
      id,
      record,
      language: this.language
    });
  }

  private async openRecordWindow(payload: RecordPayload) {
    const label = "record-viewer";
    const title = this.t("record.windowTitle", { id: payload.id + 1 });
    const url = `/?view=record&id=${payload.id}&lang=${payload.language ?? "en"}`;
    const sendPayload = async () => {
      try {
        await getCurrentWindow().emitTo(label, "record-data", payload);
      } catch (error) {
        console.error(error);
      }
    };

    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      await existing.setTitle(title);
      await existing.show();
      await existing.setFocus();
      await sendPayload();
      return;
    }

    const recordWindow = new WebviewWindow(label, {
      title,
      url,
      width: 1280,
      height: 720,
      minWidth: 960,
      minHeight: 540,
      resizable: true,
      center: true,
      focus: true
    });

    recordWindow.once("tauri://created", async () => {
      await sendPayload();
    });
    recordWindow.once("tauri://error", (error) => {
      console.error(error);
    });
  }

  private async saveUserSettings() {
    await saveSettings({
      lastPath: this.dataset?.sourcePath,
      language: this.language,
      fieldMap: this.fieldMap,
      filters: this.filters,
      distill: this.distillConfig
    });
  }

  private async loadLogs() {
    this.logEntries = await getLogs(200);
    this.showLogs = true;
  }

  private async changeLanguage(language: Language) {
    this.language = language;
    await this.saveUserSettings();
  }

  private async checkForUpdates(silent = false, autoInstall = false) {
    if (this.updateStatus === "checking") {
      return;
    }
    this.updateStatus = "checking";
    this.updateError = "";
    this.updateProgress = 0;
    if (!silent || autoInstall) {
      this.showUpdateDialog = true;
    }
    try {
      const update = await check();
      this.updateHandle = update;
        if (update) {
          this.updateInfo = {
            version: update.version,
            currentVersion: update.currentVersion,
            date: update.date,
            body: update.body
          };
          this.updateStatus = "available";
          if (autoInstall) {
            await this.installUpdate(true);
          } else {
            this.showUpdateDialog = true;
          }
      } else {
        this.updateInfo = null;
        this.updateStatus = "none";
        if (silent && !autoInstall) {
          this.showUpdateDialog = false;
        }
      }
    } catch (error) {
      this.updateStatus = "error";
      this.updateError = error instanceof Error ? error.message : String(error);
      if (silent && !autoInstall) {
        this.showUpdateDialog = false;
      }
    }
  }

  private async installUpdate(autoRestart = false) {
    if (!this.updateHandle) {
      return;
    }
    this.updateStatus = "downloading";
    this.updateProgress = 0;
    let downloaded = 0;
    try {
      await this.updateHandle.downloadAndInstall((event) => {
        if (event.event === "Progress") {
          const total = event.data.contentLength ?? 0;
          const chunk = event.data.chunkLength ?? 0;
          downloaded += chunk;
          if (total > 0) {
            this.updateProgress = Math.min(1, downloaded / total);
          }
        }
      });
      await this.updateHandle.close();
      this.updateStatus = "ready";
      this.showUpdateDialog = true;
      if (autoRestart) {
        await this.restartApp();
      }
    } catch (error) {
      this.updateStatus = "error";
      this.updateError = error instanceof Error ? error.message : String(error);
      this.showUpdateDialog = true;
    }
  }

  private async autoInstallAvailableUpdate() {
    if (this.updateStatus !== "available" || !this.updateHandle) {
      return;
    }
    this.showUpdateDialog = true;
    await this.installUpdate(true);
  }

  private async restartApp() {
    try {
      await relaunch();
    } catch (error) {
      this.updateError = error instanceof Error ? error.message : String(error);
      this.updateStatus = "error";
    }
  }

  private async updateFieldMap(key: keyof FieldMap, event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.fieldMap = { ...this.fieldMap, [key]: value || undefined };
    await setFieldMap(this.fieldMap);
    await this.refreshPreview();
    await this.saveUserSettings();
  }

  private updateFilterValue<K extends keyof FilterConfig>(
    key: K,
    value: FilterConfig[K]
  ) {
    this.filters = { ...this.filters, [key]: value };
  }

  private updateFilterText(
    key: "includeKeywords" | "excludeKeywords" | "categories",
    value: string
  ) {
    const list = value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    this.updateFilterValue(key, list as FilterConfig[typeof key]);
  }

  private updateNumberField(
    key: "minLength" | "maxLength",
    value: string
  ) {
    const parsed = value ? Number(value) : undefined;
    this.updateFilterValue(key, parsed as FilterConfig[typeof key]);
  }

  private updateDistillConfig<K extends keyof DistillConfig>(
    key: K,
    value: DistillConfig[K]
  ) {
    this.distillConfig = { ...this.distillConfig, [key]: value };
  }

  private async changeStep(index: number) {
    if (index < 0 || index > this.stepLabels.length - 1) {
      return;
    }
    if (index > 0 && !this.dataset) {
      return;
    }
    if (index === 3 && !this.distillSummary) {
      return;
    }
    this.step = index;
    if (index === 0) {
      this.previewView = "all";
    } else if (index === 1) {
      this.previewView = this.filterSummary ? "filtered" : "all";
    } else if (index === 2) {
      this.previewView = this.filterSummary ? "filtered" : "all";
    } else {
      this.previewView = "selected";
    }
    this.page = 1;
    await this.refreshPreview(this.previewView);
  }

  private async handlePagination(delta: number) {
    const next = Math.max(1, this.page + delta);
    this.page = next;
    await this.refreshPreview(this.previewView);
  }

  private formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(1)} MB`;
  }

  private escapeHtml(value: string) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  private highlightCode(value: string) {
    try {
      return hljs.highlightAuto(value).value;
    } catch {
      return this.escapeHtml(value);
    }
  }

  private renderCodeCell(value: string) {
    return html`<div class="cell-code"><code class="hljs">${unsafeHTML(
      this.highlightCode(value)
    )}</code></div>`;
  }

  private renderCodeBlock(value: string) {
    return html`<pre class="record-code"><code class="hljs">${unsafeHTML(
      this.highlightCode(value)
    )}</code></pre>`;
  }

  private stringifyRecordValue(value: unknown) {
    if (value === null || value === undefined) {
      return "";
    }
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  private parseStructuredText(value: string) {
    const trimmed = value.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return null;
      }
    }
    return null;
  }

  private getStructuredEntries(value: unknown) {
    if (Array.isArray(value)) {
      return value.map((entry, index) => ({
        key: `[${index}]`,
        value: entry
      }));
    }
    if (value && typeof value === "object") {
      return Object.entries(value as Record<string, unknown>).map(
        ([key, entry]) => ({
          key,
          value: entry
        })
      );
    }
    return [];
  }

  private renderTagList(values: unknown[]) {
    const items = values
      .map((entry) => this.stringifyRecordValue(entry))
      .filter((entry) => entry.trim().length > 0);
    if (!items.length) {
      return html`<span class="muted">—</span>`;
    }
    return html`
      <div class="meta-tags">
        ${items.map((entry) => html`<span class="tag">${entry}</span>`)}
      </div>
    `;
  }

  private renderStructuredValue(value: unknown) {
    const entries = this.getStructuredEntries(value);
    if (!entries.length) {
      return html`<span class="muted">—</span>`;
    }
    const summary = this.t("record.details", { count: entries.length });
    return html`
      <details class="meta-details" open>
        <summary>${summary}</summary>
        <div class="meta-table-wrap">
          <table class="data-table meta-table">
            <thead>
              <tr>
                <th class="cell-key">${this.t("record.field")}</th>
                <th>${this.t("record.value")}</th>
              </tr>
            </thead>
            <tbody>
              ${entries.map(
                (entry) => html`
                  <tr>
                    <td class="cell-key">${entry.key}</td>
                    <td class="cell">${this.renderRecordValue(entry.value)}</td>
                  </tr>
                `
              )}
            </tbody>
          </table>
        </div>
      </details>
    `;
  }

  private renderRecordValue(value: unknown) {
    if (Array.isArray(value)) {
      const primitivesOnly = value.every(
        (entry) =>
          entry === null ||
          entry === undefined ||
          typeof entry === "string" ||
          typeof entry === "number" ||
          typeof entry === "boolean"
      );
      if (primitivesOnly) {
        return this.renderTagList(value);
      }
      return this.renderStructuredValue(value);
    }
    if (value && typeof value === "object") {
      return this.renderStructuredValue(value);
    }
    const text = this.stringifyRecordValue(value);
    if (!text) {
      return html`<span class="muted">—</span>`;
    }
    const parsed = this.parseStructuredText(text);
    if (parsed) {
      return this.renderStructuredValue(parsed);
    }
    if (text.includes("\n") || text.length > 120) {
      return this.renderCodeCell(text);
    }
    return html`<div class="cell-text">${text}</div>`;
  }

  private getRecordEntries(record: unknown) {
    if (record && typeof record === "object") {
      if (Array.isArray(record)) {
        return record.map((value, index) => ({
          key: `[${index}]`,
          value
        }));
      }
      return Object.entries(record as Record<string, unknown>).map(
        ([key, value]) => ({
          key,
          value
        })
      );
    }
    return [{ key: this.t("record.value"), value: record }];
  }

  private renderRecordTable(record: unknown) {
    const entries = this.getRecordEntries(record);
    return html`
      <div class="table-wrap record-table-wrap">
        <table class="data-table record-table">
          <thead>
            <tr>
              <th class="cell-key">${this.t("record.field")}</th>
              <th>${this.t("record.value")}</th>
            </tr>
          </thead>
          <tbody>
            ${entries.map(
              (entry) => html`
                <tr>
                  <td class="cell-key">${entry.key}</td>
                  <td class="cell">${this.renderRecordValue(entry.value)}</td>
                </tr>
              `
            )}
          </tbody>
        </table>
      </div>
    `;
  }

  private renderEmptyTableBlock(message: string) {
    return html`
      <div class="table-wrap table-wrap-empty">
        <div class="empty-state">${message}</div>
      </div>
    `;
  }

  private getPreviewColumns() {
    const columns: string[] = [];
    const append = (name?: string) => {
      if (!name) {
        return;
      }
      if (!columns.includes(name)) {
        columns.push(name);
      }
    };
    append(this.fieldMap.instruction);
    append(this.fieldMap.output);
    append(this.fieldMap.code);
    append(this.fieldMap.category);
    append(this.fieldMap.score);
    if (!columns.length && this.preview?.items.length) {
      this.preview.items[0].fields.forEach((field) => append(field.name));
    }
    return columns;
  }

  render() {
    if (this.recordViewOnly) {
      return this.renderRecordWindow();
    }
    return html`
      <div class="app-shell">
        <nav class="stepper">
          <div class="inline-row">
            ${this.stepLabels.map((label, index) =>
              index === this.step
                ? html`<md-filled-tonal-button
                    @click=${() => this.changeStep(index)}
                    >${label}</md-filled-tonal-button
                  >`
                : html`<md-outlined-button
                    ?disabled=${index > 0 && !this.dataset}
                    @click=${() => this.changeStep(index)}
                    >${label}</md-outlined-button
                  >`
            )}
          </div>
        </nav>
        <main class="content">
          ${this.step === 0
            ? this.renderImportStep()
            : this.step === 1
              ? this.renderFilterStep()
              : this.step === 2
                ? this.renderDistillStep()
                : this.renderReviewStep()}
        </main>
        ${this.renderDialogs()}
      </div>
      ${this.booting ? this.renderSplash() : nothing}
    `;
  }

  private renderRecordWindow() {
    const title = this.recordDetail
      ? this.t("record.windowTitle", { id: this.recordDetail.id + 1 })
      : this.t("record.windowTitleEmpty");
    const emptyState = html`
      <div class="table-wrap record-table-wrap table-wrap-empty">
        <div class="empty-state">
          ${this.recordError ? this.recordError : this.t("hint.noData")}
        </div>
      </div>
    `;
    return html`
      <div class="record-window">
        <header class="record-window-header">
          <div>
            <div class="record-window-title">${title}</div>
            <div class="record-window-subtitle">
              ${this.t("record.windowSubtitle")}
            </div>
          </div>
        </header>
        <section class="record-window-body">
          ${this.recordDetail ? this.renderRecordTable(this.recordDetail.record) : emptyState}
        </section>
      </div>
    `;
  }

  private async closeRecordWindow() {
    try {
      await getCurrentWindow().close();
    } catch (error) {
      console.error(error);
    }
  }

  private renderSplash() {
    const progress = Math.round(this.bootProgress * 100);
    return html`
      <div class="splash">
        <div class="splash-card">
          <div class="splash-header">
            <div>
              <div class="splash-brand">${this.t("splash.brand")}</div>
              <div class="splash-tagline">${this.t("splash.tagline")}</div>
            </div>
            <div class="splash-logo">
              <div class="splash-logo-box">${this.t("splash.logo")}</div>
            </div>
          </div>
          <div class="splash-progress">
            <div class="splash-bar">
              <div class="splash-bar-fill" style="width: ${progress}%"></div>
            </div>
            <div class="splash-status">${this.t("splash.status")}</div>
          </div>
          <div class="splash-footer">${this.t("splash.footer", { version: "v0.1.2" })}</div>
        </div>
      </div>
    `;
  }

  private renderImportStep() {
    const menuBody = html`
      <div class="actions">
        <md-filled-button
          ?disabled=${this.busy}
          @click=${() => this.handleImport()}
          >${this.t("action.import")}</md-filled-button
        >
        ${this.busy
          ? html`<md-outlined-button @click=${() => cancelTask()}
              >${this.t("action.cancel")}</md-outlined-button
            >`
          : nothing}
      </div>
      ${this.dataset
        ? html`
            <div>
              <div class="panel-title">${this.t("panel.summary.title")}</div>
              <div class="summary-grid">
                <div class="summary-card">
                  <div class="summary-label">${this.t("summary.records")}</div>
                  <div class="summary-value">${this.dataset.recordCount}</div>
                </div>
                <div class="summary-card">
                  <div class="summary-label">${this.t("summary.fields")}</div>
                  <div class="summary-value">${this.dataset.fields.length}</div>
                </div>
                <div class="summary-card">
                  <div class="summary-label">${this.t("summary.size")}</div>
                  <div class="summary-value">
                    ${this.formatBytes(this.dataset.sizeBytes)}
                  </div>
                </div>
              </div>
              <div class="hint">
                ${this.t("hint.fieldsDetected", {
                  fields: this.dataset.fields.join(", ")
                })}
              </div>
            </div>
          `
        : html`<div class="empty-state">${this.t("hint.importEmpty")}</div>`}
      ${this.dataset ? this.renderFieldMapping() : nothing}
    `;
    return html`
      <div class=${this.getSplitClass()}>
        ${this.renderMenuPanel(
          this.t("panel.import.title"),
          this.t("panel.import.subtitle"),
          menuBody
        )}
        <section class="panel">
          <div class="panel-title">${this.t("panel.preview.title")}</div>
          <div class="panel-subtitle">
            ${this.t("panel.preview.subtitle")}
          </div>
          ${this.renderPreviewBlock(false)}
        </section>
      </div>
    `;
  }

  private renderFieldMapping() {
    const options = this.dataset?.fields ?? [];
    const renderSelect = (
      label: string,
      value: string | undefined,
      onChange: (event: Event) => void
    ) => html`
      <md-outlined-select
        label=${label}
        value=${value ?? ""}
        @change=${onChange}
      >
        <md-select-option value="">
          <div slot="headline">${this.t("option.none")}</div>
        </md-select-option>
        ${options.map(
          (option) => html`
            <md-select-option value=${option}>
              <div slot="headline">${option}</div>
            </md-select-option>
          `
        )}
      </md-outlined-select>
    `;

    return html`
      <div>
        <div class="panel-title">${this.t("panel.mapping.title")}</div>
        <div class="panel-subtitle">
          ${this.t("panel.mapping.subtitle")}
        </div>
        <div class="field-grid">
          ${renderSelect(this.t("field.instruction"), this.fieldMap.instruction, (e) =>
            this.updateFieldMap("instruction", e)
          )}
          ${renderSelect(this.t("field.output"), this.fieldMap.output, (e) =>
            this.updateFieldMap("output", e)
          )}
          ${renderSelect(this.t("field.code"), this.fieldMap.code, (e) =>
            this.updateFieldMap("code", e)
          )}
          ${renderSelect(this.t("field.category"), this.fieldMap.category, (e) =>
            this.updateFieldMap("category", e)
          )}
          ${renderSelect(this.t("field.score"), this.fieldMap.score, (e) =>
            this.updateFieldMap("score", e)
          )}
        </div>
      </div>
    `;
  }

  private renderFilterStep() {
    const menuBody = html`
      <div class="field-grid">
        <md-outlined-text-field
          label=${this.t("field.minLength")}
          type="number"
          value=${this.filters.minLength ?? ""}
          @input=${(event: Event) =>
            this.updateNumberField(
              "minLength",
              (event.target as HTMLInputElement).value
            )}
        ></md-outlined-text-field>
        <md-outlined-text-field
          label=${this.t("field.maxLength")}
          type="number"
          value=${this.filters.maxLength ?? ""}
          @input=${(event: Event) =>
            this.updateNumberField(
              "maxLength",
              (event.target as HTMLInputElement).value
            )}
        ></md-outlined-text-field>
        <md-outlined-select
          label=${this.t("field.lengthScope")}
          value=${this.filters.lengthScope}
          @change=${(event: Event) =>
            this.updateFilterValue(
              "lengthScope",
              (event.target as HTMLInputElement).value as FilterConfig["lengthScope"]
            )}
        >
          <md-select-option value="instruction">
            <div slot="headline">${this.t("field.instruction")}</div>
          </md-select-option>
          <md-select-option value="output">
            <div slot="headline">${this.t("field.output")}</div>
          </md-select-option>
          <md-select-option value="combined">
            <div slot="headline">${this.t("field.combined")}</div>
          </md-select-option>
        </md-outlined-select>
      </div>
      <div class="field-grid">
        <md-outlined-text-field
          label=${this.t("field.includeKeywords")}
          value=${this.filters.includeKeywords.join(", ")}
          @input=${(event: Event) =>
            this.updateFilterText(
              "includeKeywords",
              (event.target as HTMLInputElement).value
            )}
        ></md-outlined-text-field>
        <md-outlined-text-field
          label=${this.t("field.excludeKeywords")}
          value=${this.filters.excludeKeywords.join(", ")}
          @input=${(event: Event) =>
            this.updateFilterText(
              "excludeKeywords",
              (event.target as HTMLInputElement).value
            )}
        ></md-outlined-text-field>
      </div>
      <div class="field-grid">
        <label class="inline-row">
          <md-checkbox
            ?checked=${this.filters.requireFields.length > 0}
            @change=${(event: Event) => {
              const checked = (event.target as HTMLInputElement).checked;
              const required = checked
                ? [this.fieldMap.instruction, this.fieldMap.output]
                    .filter(Boolean)
                    .map((field) => field as string)
                : [];
              this.updateFilterValue("requireFields", required);
            }}
          ></md-checkbox>
          ${this.t("filter.requireFields")}
        </label>
        <label class="inline-row">
          <md-checkbox
            ?checked=${this.filters.dedupeExact}
            @change=${(event: Event) =>
              this.updateFilterValue(
                "dedupeExact",
                (event.target as HTMLInputElement).checked
              )}
          ></md-checkbox>
          ${this.t("filter.dedupeExact")}
        </label>
        <label class="inline-row">
          <md-checkbox
            ?checked=${this.filters.dedupeFuzzy}
            @change=${(event: Event) =>
              this.updateFilterValue(
                "dedupeFuzzy",
                (event.target as HTMLInputElement).checked
              )}
          ></md-checkbox>
          ${this.t("filter.dedupeFuzzy")}
        </label>
        <label class="inline-row">
          <md-checkbox
            ?checked=${this.filters.keywordCaseSensitive}
            @change=${(event: Event) =>
              this.updateFilterValue(
                "keywordCaseSensitive",
                (event.target as HTMLInputElement).checked
              )}
          ></md-checkbox>
          ${this.t("filter.keywordCase")}
        </label>
      </div>
      ${this.fieldMap.category
        ? html`
            <div>
              <div class="panel-title">${this.t("filter.categoryTitle")}</div>
              <div class="panel-subtitle">
                ${this.t("filter.categoryHint", {
                  field: this.fieldMap.category ?? ""
                })}
              </div>
              <md-outlined-text-field
                label=${this.t("field.categories")}
                value=${this.filters.categories.join(", ")}
                @input=${(event: Event) =>
                  this.updateFilterText(
                    "categories",
                    (event.target as HTMLInputElement).value
                  )}
              ></md-outlined-text-field>
              ${this.categorySuggestions.length
                ? html`<div class="hint">
                    ${this.t("filter.topCategories", {
                      categories: this.categorySuggestions
                        .slice(0, 6)
                        .map((cat) => `${cat.name} (${cat.count})`)
                        .join(", ")
                    })}
                  </div>`
                : nothing}
            </div>
          `
        : html`<div class="hint">${this.t("filter.categoryMissing")}</div>`}
      <div class="actions">
        <md-filled-button
          ?disabled=${this.busy || !this.dataset}
          @click=${() => this.applyFilterConfig()}
          >${this.t("action.applyFilters")}</md-filled-button
        >
      </div>
      ${this.filterSummary
        ? html`
            <div class="summary-card">
              <div class="summary-label">${this.t("summary.filtered")}</div>
              <div class="summary-value">
                ${this.t("summary.valueOf", {
                  value: this.filterSummary.filteredCount,
                  total: this.filterSummary.totalCount
                })}
              </div>
              <div class="hint">
                ${this.t("summary.removedCount", {
                  count: this.filterSummary.duplicatesRemoved
                })}
              </div>
            </div>
          `
        : nothing}
    `;
    return html`
      <div class=${this.getSplitClass()}>
        ${this.renderMenuPanel(
          this.t("panel.filter.title"),
          this.t("panel.filter.subtitle"),
          menuBody
        )}
        <section class="panel">
          <div class="panel-title">${this.t("panel.filtered.title")}</div>
          <div class="panel-subtitle">
            ${this.t("panel.filtered.subtitle")}
          </div>
          ${this.renderPreviewBlock(false)}
        </section>
      </div>
    `;
  }

  private renderDistillStep() {
    const menuBody = html`
      <div class="field-grid">
        <md-outlined-select
          label=${this.t("field.targetMode")}
          value=${this.distillConfig.targetCount ? "count" : "percent"}
          @change=${(event: Event) => {
            const value = (event.target as HTMLInputElement).value;
            if (value === "count") {
              this.updateDistillConfig("targetCount", 1000);
              this.updateDistillConfig("targetPercent", undefined);
            } else {
              this.updateDistillConfig("targetPercent", 10);
              this.updateDistillConfig("targetCount", undefined);
            }
          }}
        >
          <md-select-option value="percent">
            <div slot="headline">${this.t("distill.mode.percent")}</div>
          </md-select-option>
          <md-select-option value="count">
            <div slot="headline">${this.t("distill.mode.count")}</div>
          </md-select-option>
        </md-outlined-select>
        <md-outlined-text-field
          label=${this.t("field.targetValue")}
          type="number"
          value=${this.distillConfig.targetCount ?? this.distillConfig.targetPercent ?? 10}
          @input=${(event: Event) => {
            const value = Number((event.target as HTMLInputElement).value);
            if (this.distillConfig.targetCount) {
              this.updateDistillConfig("targetCount", value);
            } else {
              this.updateDistillConfig("targetPercent", value);
            }
          }}
        ></md-outlined-text-field>
        <md-outlined-select
          label=${this.t("field.strategy")}
          value=${this.distillConfig.strategy}
          @change=${(event: Event) =>
            this.updateDistillConfig(
              "strategy",
              (event.target as HTMLInputElement).value as DistillConfig["strategy"]
            )}
        >
          <md-select-option value="random">
            <div slot="headline">${this.t("distill.strategy.random")}</div>
          </md-select-option>
          <md-select-option value="diversity">
            <div slot="headline">${this.t("distill.strategy.diversity")}</div>
          </md-select-option>
          <md-select-option value="importance">
            <div slot="headline">${this.t("distill.strategy.importance")}</div>
          </md-select-option>
        </md-outlined-select>
        <md-outlined-text-field
          label=${this.t("field.randomSeed")}
          type="number"
          value=${this.distillConfig.randomSeed ?? ""}
          @input=${(event: Event) =>
            this.updateDistillConfig(
              "randomSeed",
              Number((event.target as HTMLInputElement).value) || undefined
            )}
        ></md-outlined-text-field>
      </div>
      <label class="inline-row">
        <md-switch
          .selected=${this.distillConfig.preserveCategoryBalance}
          @change=${(event: Event) => {
            const target = event.target as HTMLInputElement & { selected?: boolean };
            const selected = target.selected ?? target.checked;
            this.updateDistillConfig("preserveCategoryBalance", selected);
          }}
        ></md-switch>
        ${this.t("distill.preserveBalance")}
      </label>
      <div class="actions">
        <md-filled-button
          ?disabled=${this.busy || !this.dataset}
          @click=${() => this.runDistillationPreview()}
          >${this.t("action.previewDistill")}</md-filled-button
        >
      </div>
      ${this.distillSummary
        ? html`
            <div class="summary-card">
              <div class="summary-label">${this.t("summary.selected")}</div>
              <div class="summary-value">
                ${this.t("summary.valueOf", {
                  value: this.distillSummary.selectedCount,
                  total: this.distillSummary.totalCount
                })}
              </div>
              <div class="hint">
                ${this.t("summary.removedCount", {
                  count: this.distillSummary.removedCount
                })}
              </div>
            </div>
          `
        : html`<div class="hint">${this.t("hint.distillEmpty")}</div>`}
    `;
    return html`
      <div class=${this.getSplitClass()}>
        ${this.renderMenuPanel(
          this.t("panel.distill.title"),
          this.t("panel.distill.subtitle"),
          menuBody
        )}
        <section class="panel">
          <div class="panel-title">${this.t("panel.selection.title")}</div>
          <div class="panel-subtitle">
            ${this.t("panel.selection.subtitle")}
          </div>
          ${this.renderPreviewBlock(false)}
        </section>
      </div>
    `;
  }

  private renderReviewStep() {
    const menuBody = html`
      <div class="actions">
        <md-outlined-button
          ?disabled=${!this.distillSummary}
          @click=${() => this.handleExport("selected")}
          >${this.t("action.exportSelected")}</md-outlined-button
        >
        <md-outlined-button
          ?disabled=${!this.distillSummary}
          @click=${() => this.handleExport("removed")}
          >${this.t("action.exportRemoved")}</md-outlined-button
        >
      </div>
      ${this.distillSummary
        ? html`
            <div class="summary-grid">
              <div class="summary-card">
                <div class="summary-label">${this.t("summary.original")}</div>
                <div class="summary-value">${this.distillSummary.totalCount}</div>
              </div>
              <div class="summary-card">
                <div class="summary-label">${this.t("summary.selected")}</div>
                <div class="summary-value">
                  ${this.distillSummary.selectedCount}
                </div>
              </div>
              <div class="summary-card">
                <div class="summary-label">${this.t("summary.removed")}</div>
                <div class="summary-value">${this.distillSummary.removedCount}</div>
              </div>
            </div>
          `
        : nothing}
      <div class="actions">
        <md-outlined-button
          ?disabled=${!this.distillSummary}
          @click=${async () => {
            this.previewView = "selected";
            this.page = 1;
            await this.refreshPreview("selected");
          }}
          >${this.t("action.selected")}</md-outlined-button
        >
        <md-outlined-button
          ?disabled=${!this.distillSummary}
          @click=${async () => {
            this.previewView = "removed";
            this.page = 1;
            await this.refreshPreview("removed");
          }}
          >${this.t("action.removed")}</md-outlined-button
        >
      </div>
    `;
    return html`
      <div class=${this.getSplitClass()}>
        ${this.renderMenuPanel(
          this.t("panel.review.title"),
          this.t("panel.review.subtitle"),
          menuBody
        )}
        <section class="panel">
          <div class="panel-title">${this.t("panel.preview.title")}</div>
          <div class="panel-subtitle">
            ${this.t("panel.preview.subtitle")}
          </div>
          ${this.renderPreviewBlock(true)}
        </section>
      </div>
    `;
  }

  private renderPreviewBlock(allowToggle: boolean) {
    if (!this.dataset) {
      return this.renderEmptyTableBlock(this.t("hint.noData"));
    }
    if (!this.preview || this.preview.items.length === 0) {
      return this.renderEmptyTableBlock(this.t("hint.noRecords"));
    }
    const totalPages = Math.max(
      1,
      Math.ceil(this.preview.totalCount / this.preview.pageSize)
    );
    const allowSelectionToggle =
      allowToggle &&
      (this.previewView === "selected" || this.previewView === "removed");
    const columns = this.getPreviewColumns();

    return html`
      <div class="table-meta">
        <div class="inline-row">
          <span class="pill">${this.t("status.records", {
            count: this.preview.totalCount
          })}</span>
          <span class="pill">${this.t("status.view", {
            view: this.viewLabel(this.previewView)
          })}</span>
        </div>
        <div class="pagination">
          <md-outlined-button
            ?disabled=${this.page <= 1}
            @click=${() => this.handlePagination(-1)}
            >${this.t("action.back")}</md-outlined-button
          >
          <span class="muted">${this.t("status.page", {
            page: this.page,
            total: totalPages
          })}</span>
          <md-outlined-button
            ?disabled=${this.page >= totalPages}
            @click=${() => this.handlePagination(1)}
            >${this.t("action.next")}</md-outlined-button
          >
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              ${allowSelectionToggle ? html`<th class="cell-check"></th>` : nothing}
              <th class="cell-id">#</th>
              ${columns.map(
                (column) => html`<th class="cell-header">${column}</th>`
              )}
              <th class="cell-action"></th>
            </tr>
          </thead>
          <tbody>
            ${this.preview.items.map((item) => {
              const fieldMap = new Map(
                item.fields.map((field) => [field.name, field])
              );
              const isSelected = this.previewView === "selected";
              return html`
                <tr>
                  ${allowSelectionToggle
                    ? html`<td class="cell-check">
                        <md-checkbox
                          ?checked=${isSelected}
                          @change=${(event: Event) =>
                            this.handleManualToggle(
                              item.id,
                              (event.target as HTMLInputElement).checked
                            )}
                        ></md-checkbox>
                      </td>`
                    : nothing}
                  <td class="cell-id">#${item.id + 1}</td>
                  ${columns.map((column) => {
                    const field = fieldMap.get(column);
                    if (!field) {
                      return html`<td class="cell"><span class="muted">—</span></td>`;
                    }
                    return html`<td class="cell">
                      ${field.kind === "code"
                        ? this.renderCodeCell(field.value)
                        : html`<div class="cell-text">${field.value}</div>`}
                    </td>`;
                  })}
                  <td class="cell-action">
                    <md-outlined-button @click=${() => this.showRecord(item.id)}
                      >${this.t("action.view")}</md-outlined-button
                    >
                  </td>
                </tr>
              `;
            })}
          </tbody>
        </table>
      </div>
    `;
  }

  private renderDialogs() {
    return html`
      <md-dialog ?open=${Boolean(this.progress)}>
        <div slot="headline">${this.t("dialog.working.title")}</div>
        <div slot="content" class="progress-block">
          <div>${this.progress?.message ?? this.t("dialog.working.body")}</div>
          ${this.progress
            ? html`<md-linear-progress
                ?indeterminate=${this.progress.total === 0}
                .value=${this.progress.total
                  ? this.progress.current / this.progress.total
                  : 0}
              ></md-linear-progress>`
            : nothing}
        </div>
      </md-dialog>

      <md-dialog ?open=${Boolean(this.errorMessage)}>
        <div slot="headline">${this.t("dialog.error.title")}</div>
        <div slot="content">${this.errorMessage}</div>
        <div slot="actions">
          <md-outlined-button @click=${() => (this.errorMessage = "")}
            >${this.t("action.close")}</md-outlined-button
          >
        </div>
      </md-dialog>

      <md-dialog ?open=${this.showHelp}>
        <div slot="headline">${this.t("dialog.help.title")}</div>
        <div slot="content" class="stack">
          <div>${this.t("dialog.help.body1")}</div>
          <div>${this.t("dialog.help.body2")}</div>
          <div>${this.t("dialog.help.body3")}</div>
        </div>
        <div slot="actions">
          <md-outlined-button @click=${() => (this.showHelp = false)}
            >${this.t("action.close")}</md-outlined-button
          >
        </div>
      </md-dialog>

      <md-dialog ?open=${this.showLogs}>
        <div slot="headline">${this.t("dialog.logs.title")}</div>
        <div slot="content">
          ${this.logEntries.length
            ? html`<pre class="record-code"><code>${this.logEntries.join(
                "\n"
              )}</code></pre>`
            : html`<div class="empty-state">${this.t("dialog.logs.empty")}</div>`}
        </div>
        <div slot="actions">
          <md-outlined-button @click=${() => (this.showLogs = false)}
            >${this.t("action.close")}</md-outlined-button
          >
        </div>
      </md-dialog>

      <md-dialog ?open=${this.showUpdateDialog}>
        <div slot="headline">${this.t("action.checkUpdates")}</div>
        <div slot="content" class="stack">
          ${this.updateStatus === "checking"
            ? html`<div>${this.t("splash.step.updates")}</div>`
            : nothing}
          ${this.updateStatus === "available" && this.updateInfo
            ? html`
                <div class="panel-title">${this.t("update.available")}</div>
                <div class="pill">${this.t("update.version", {
                  version: this.updateInfo.version
                })}</div>
                ${this.updateInfo.body
                  ? html`<div class="record-value">
                      ${this.t("update.notes")}: ${this.updateInfo.body}
                    </div>`
                  : nothing}
              `
            : nothing}
          ${this.updateStatus === "none"
            ? html`<div>${this.t("update.none")}</div>`
            : nothing}
          ${this.updateStatus === "downloading"
            ? html`<div class="progress-block">
                <div>${this.t("update.installing")}</div>
                <md-linear-progress .value=${this.updateProgress}></md-linear-progress>
              </div>`
            : nothing}
          ${this.updateStatus === "ready"
            ? html`<div>${this.t("update.ready")}</div>`
            : nothing}
          ${this.updateStatus === "error"
            ? html`<div class="record-value">${this.updateError}</div>`
            : nothing}
        </div>
        <div slot="actions">
          ${this.updateStatus === "available"
            ? html`<md-filled-button @click=${() => this.installUpdate()}
                >${this.t("action.installUpdate")}</md-filled-button
              >`
            : nothing}
          ${this.updateStatus === "ready"
            ? html`<md-filled-button @click=${() => this.restartApp()}
                >${this.t("action.restart")}</md-filled-button
              >`
            : nothing}
          <md-outlined-button @click=${() => (this.showUpdateDialog = false)}
            >${this.t("action.dismiss")}</md-outlined-button
          >
        </div>
      </md-dialog>
    `;
  }
}
