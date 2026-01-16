export type ViewMode = "all" | "filtered" | "selected" | "removed";

export interface DatasetSummary {
  id: string;
  sourcePath: string;
  format: string;
  recordCount: number;
  fields: string[];
  sizeBytes: number;
}

export interface PreviewField {
  name: string;
  value: string;
  kind: "text" | "code" | "meta";
}

export interface PreviewItem {
  id: number;
  fields: PreviewField[];
}

export interface PreviewPage {
  items: PreviewItem[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export interface FieldMap {
  instruction?: string;
  output?: string;
  code?: string;
  category?: string;
  score?: string;
}

export interface FilterConfig {
  requireFields: string[];
  minLength?: number;
  maxLength?: number;
  includeKeywords: string[];
  excludeKeywords: string[];
  categoryField?: string;
  categories: string[];
  dedupeExact: boolean;
  dedupeFuzzy: boolean;
  lengthScope: "instruction" | "output" | "combined";
  keywordCaseSensitive: boolean;
}

export interface FilterSummary {
  totalCount: number;
  filteredCount: number;
  duplicatesRemoved: number;
}

export type DistillStrategy = "random" | "diversity" | "importance";

export interface DistillConfig {
  targetCount?: number;
  targetPercent?: number;
  strategy: DistillStrategy;
  randomSeed?: number;
  preserveCategoryBalance: boolean;
}

export interface DistillSummary {
  totalCount: number;
  selectedCount: number;
  removedCount: number;
}

export interface ManualChange {
  id: number;
  include: boolean;
}

export interface ProgressEvent {
  stage: string;
  current: number;
  total: number;
  message?: string;
}

export interface CategoryCount {
  name: string;
  count: number;
}

export interface Settings {
  lastPath?: string;
  language?: string;
  fieldMap: FieldMap;
  filters: FilterConfig;
  distill: DistillConfig;
}
