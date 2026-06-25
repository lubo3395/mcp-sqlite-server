import type { DatabaseSync } from "node:sqlite";

export interface DbState {
  mainDb: DatabaseSync;
  dbPaths: string[];
  readonly: boolean;
  attachAliases: string[];
  maxRows: number;
}

export interface ColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

export interface IndexInfo {
  name: string;
  unique: boolean;
  columns: string[];
}

export interface TableInfo {
  name: string;
  row_count: number;
}

export interface SchemaResult {
  table: string;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  ddl: string;
}

export interface QueryResult {
  sql: string;
  columns: string[];
  rows: unknown[][];
  row_count: number;
  total_count: number;
  has_more: boolean;
}

export interface CreateTableResult {
  table: string;
  if_not_exists: boolean;
}

export interface DropTableResult {
  table: string;
  if_exists: boolean;
}

export interface AddColumnResult {
  table: string;
  column_name: string;
}

export interface CreateIndexResult {
  index_name: string;
  table: string;
  unique: boolean;
}

export interface DropIndexResult {
  index_name: string;
  if_exists: boolean;
}

export interface ImportResult {
  table: string;
  rows_imported: number;
  source_file: string;
}

export interface ExportResult {
  file_path: string;
  row_count: number;
  format: "csv" | "json";
}

export interface ColumnDef {
  name: string;
  type: string;
  primaryKey?: boolean;
  autoIncrement?: boolean;
  notnull?: boolean;
  unique?: boolean;
  defaultValue?: string;
}
