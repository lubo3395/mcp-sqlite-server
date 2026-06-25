import { readFileSync, writeFileSync } from "fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DbState, ImportResult, ExportResult } from "../types.js";
import { ImportCsvSchema, ImportJsonSchema, ExportCsvSchema, ExportJsonSchema } from "../schemas.js";
import {
  handleError,
  resolveFilePath,
  checkOutputPath,
  parseCsv,
  inferType,
  formatCsvRow,
  quoteIdentifier,
} from "../utils.js";

function checkReadonly(dbState: DbState): void {
  if (dbState.readonly) {
    throw new Error("当前为只读模式，不允许导入操作。请移除 --readonly 参数重启服务");
  }
}

function handleImportCsv(
  dbState: DbState,
  params: {
    file_path: string;
    table: string;
    create_if_not_exists: boolean;
    delimiter: string;
    has_header: boolean;
    db_alias?: string;
  },
): ImportResult {
  checkReadonly(dbState);

  const filePath = resolveFilePath(params.file_path);
  const content = readFileSync(filePath, "utf-8");
  const { headers, rows } = parseCsv(content, params.delimiter, params.has_header);

  if (rows.length === 0) {
    throw new Error("CSV 文件没有数据行");
  }

  const qualifiedTable = params.db_alias && params.db_alias !== "main"
    ? `"${params.db_alias}".${quoteIdentifier(params.table)}`
    : quoteIdentifier(params.table);

  const tableExists = dbState.mainDb.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
  ).get(params.table);

  if (!tableExists) {
    if (!params.create_if_not_exists) {
      throw new Error(
        `表 ${params.table} 不存在。请设置 create_if_not_exists=true 自动创建，或先创建表`,
      );
    }

    const colDefs = headers.map((h, i) => {
      const sampleValues = rows.slice(0, 100).map((r) => r[i]).filter((v) => v !== "");
      const types = sampleValues.map((v) => inferType(v));
      const typeCount: Record<string, number> = {};
      for (const t of types) {
        typeCount[t] = (typeCount[t] || 0) + 1;
      }
      const bestType =
        Object.entries(typeCount).sort((a, b) => b[1] - a[1])[0]?.[0] || "TEXT";
      return `${quoteIdentifier(h)} ${bestType}`;
    });

    dbState.mainDb.exec(`CREATE TABLE ${qualifiedTable} (${colDefs.join(", ")})`);
  }

  const placeholders = headers.map(() => "?").join(", ");
  const insertSql = `INSERT INTO ${qualifiedTable} (${headers.map((h) => quoteIdentifier(h)).join(", ")}) VALUES (${placeholders})`;
  const insertStmt = dbState.mainDb.prepare(insertSql);

  dbState.mainDb.exec("BEGIN");
  try {
    let imported = 0;
    for (const row of rows) {
      insertStmt.run(...(row as []));
      imported++;
    }
    dbState.mainDb.exec("COMMIT");

    return { table: params.table, rows_imported: imported, source_file: filePath };
  } catch (error) {
    dbState.mainDb.exec("ROLLBACK");
    throw error;
  }
}

function handleImportJson(
  dbState: DbState,
  params: {
    file_path: string;
    table: string;
    create_if_not_exists: boolean;
    db_alias?: string;
  },
): ImportResult {
  checkReadonly(dbState);

  const filePath = resolveFilePath(params.file_path);
  const content = readFileSync(filePath, "utf-8");
  let data: unknown[];
  try {
    data = JSON.parse(content) as unknown[];
  } catch {
    throw new Error("JSON 文件格式无效，请确保是有效的 JSON 数组");
  }

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("JSON 文件必须包含非空数组");
  }

  const qualifiedTable = params.db_alias && params.db_alias !== "main"
    ? `"${params.db_alias}".${quoteIdentifier(params.table)}`
    : quoteIdentifier(params.table);

  const isArrayOfObjects = typeof data[0] === "object" && !Array.isArray(data[0]);
  let headers: string[];
  let rows: unknown[][];

  if (isArrayOfObjects) {
    const objectRows = data as Record<string, unknown>[];
    headers = Object.keys(objectRows[0]);
    rows = objectRows.map((row) => headers.map((h) => row[h] ?? null));
  } else {
    const arrayRows = data as unknown[][];
    headers = arrayRows[0].map((_, i) => `col${i + 1}`);
    rows = arrayRows;
  }

  if (rows.length === 0) {
    throw new Error("JSON 文件没有数据行");
  }

  const tableExists = dbState.mainDb.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
  ).get(params.table);

  if (!tableExists) {
    if (!params.create_if_not_exists) {
      throw new Error(
        `表 ${params.table} 不存在。请设置 create_if_not_exists=true 自动创建，或先创建表`,
      );
    }

    const colDefs = headers.map((h) => {
      const sampleValues = rows.slice(0, 100).map((r) => {
        const val = r[headers.indexOf(h)];
        return val !== null && val !== undefined ? String(val) : "";
      }).filter((v) => v !== "");
      const types = sampleValues.map((v) => inferType(v));
      const typeCount: Record<string, number> = {};
      for (const t of types) {
        typeCount[t] = (typeCount[t] || 0) + 1;
      }
      const bestType =
        Object.entries(typeCount).sort((a, b) => b[1] - a[1])[0]?.[0] || "TEXT";
      return `${quoteIdentifier(h)} ${bestType}`;
    });

    dbState.mainDb.exec(`CREATE TABLE ${qualifiedTable} (${colDefs.join(", ")})`);
  }

  const placeholders = headers.map(() => "?").join(", ");
  const insertSql = `INSERT INTO ${qualifiedTable} (${headers.map((h) => quoteIdentifier(h)).join(", ")}) VALUES (${placeholders})`;
  const insertStmt = dbState.mainDb.prepare(insertSql);

  dbState.mainDb.exec("BEGIN");
  try {
    let imported = 0;
    for (const row of rows) {
      insertStmt.run(...(row as []));
      imported++;
    }
    dbState.mainDb.exec("COMMIT");

    return { table: params.table, rows_imported: imported, source_file: filePath };
  } catch (error) {
    dbState.mainDb.exec("ROLLBACK");
    throw error;
  }
}

function handleExportCsv(
  dbState: DbState,
  params: {
    sql: string;
    output: string;
    params?: unknown[];
    delimiter: string;
    include_header: boolean;
    overwrite: boolean;
    db_alias?: string;
  },
): ExportResult {
  const outputPath = checkOutputPath(params.output, params.overwrite);

  const stmt = dbState.mainDb.prepare(params.sql);
  const rawRows = params.params && params.params.length > 0
    ? stmt.all(...(params.params as []))
    : stmt.all();
  const rows = rawRows as unknown as Record<string, unknown>[];
  const columns = stmt.columns().map((c) => c.name);

  const lines: string[] = [];

  if (params.include_header) {
    lines.push(columns.map((c) => formatCsvRow([c], params.delimiter)).join(params.delimiter));
  }

  for (const row of rows) {
    lines.push(formatCsvRow(columns.map((c) => row[c] ?? null), params.delimiter));
  }

  writeFileSync(outputPath, lines.join("\n") + "\n", "utf-8");

  return { file_path: outputPath, row_count: rows.length, format: "csv" };
}

function handleExportJson(
  dbState: DbState,
  params: {
    sql: string;
    output: string;
    params?: unknown[];
    pretty: boolean;
    overwrite: boolean;
    db_alias?: string;
  },
): ExportResult {
  const outputPath = checkOutputPath(params.output, params.overwrite);

  const stmt = dbState.mainDb.prepare(params.sql);
  const rawRows = params.params && params.params.length > 0
    ? stmt.all(...(params.params as []))
    : stmt.all();
  const rows = rawRows as unknown as Record<string, unknown>[];

  const json = params.pretty
    ? JSON.stringify(rows, null, 2)
    : JSON.stringify(rows);

  writeFileSync(outputPath, json, "utf-8");

  return { file_path: outputPath, row_count: rows.length, format: "json" };
}

export function registerIoTools(server: McpServer, dbState: DbState): void {
  server.registerTool(
    "sqlite_import_csv",
    {
      title: "导入 CSV",
      description: `从 CSV 文件导入数据到指定表。

支持:
  - 自定义分隔符（默认逗号）
  - 带引号的字段（含换行和分隔符的字段）
  - 自动创建表（基于数据推断列类型）

参数:
  - file_path: CSV 文件路径（必填）
  - table: 目标表名（必填）
  - create_if_not_exists: 表不存在时是否自动创建
  - delimiter: 分隔符（默认 ","）
  - has_header: 是否包含表头行（默认 true）
  - db_alias: 数据库别名（可选）

返回:
  - 导入的行数`,
      inputSchema: ImportCsvSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const result = handleImportCsv(dbState, params);
        return {
          content: [{
            type: "text",
            text: `已从 ${result.source_file} 导入 ${result.rows_imported} 行到表 ${result.table}`,
          }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: handleError(error) }] };
      }
    }
  );

  server.registerTool(
    "sqlite_import_json",
    {
      title: "导入 JSON",
      description: `从 JSON 文件导入数据到指定表。

支持:
  - 对象数组格式: [{"col1": "val1", "col2": "val2"}, ...]
  - 自动创建表（基于数据推断列类型）

参数:
  - file_path: JSON 文件路径（必填）
  - table: 目标表名（必填）
  - create_if_not_exists: 表不存在时是否自动创建
  - db_alias: 数据库别名（可选）

返回:
  - 导入的行数`,
      inputSchema: ImportJsonSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const result = handleImportJson(dbState, params);
        return {
          content: [{
            type: "text",
            text: `已从 ${result.source_file} 导入 ${result.rows_imported} 行到表 ${result.table}`,
          }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: handleError(error) }] };
      }
    }
  );

  server.registerTool(
    "sqlite_export_csv",
    {
      title: "导出 CSV",
      description: `将 SQL 查询结果导出为 CSV 文件。

参数:
  - sql: SELECT 查询语句（必填）
  - output: CSV 输出文件路径（必填）
  - params: 参数化查询参数（可选）
  - delimiter: CSV 分隔符（默认 ","）
  - include_header: 是否包含表头行（默认 true）
  - overwrite: 是否覆盖已存在的文件（默认 false）
  - db_alias: 数据库别名（可选）

返回:
  - 导出文件路径和行数`,
      inputSchema: ExportCsvSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const result = handleExportCsv(dbState, params);
        return {
          content: [{
            type: "text",
            text: `已导出 ${result.row_count} 行到 ${result.file_path}`,
          }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: handleError(error) }] };
      }
    }
  );

  server.registerTool(
    "sqlite_export_json",
    {
      title: "导出 JSON",
      description: `将 SQL 查询结果导出为 JSON 文件。

参数:
  - sql: SELECT 查询语句（必填）
  - output: JSON 输出文件路径（必填）
  - params: 参数化查询参数（可选）
  - pretty: 是否美化 JSON 输出（默认 false）
  - overwrite: 是否覆盖已存在的文件（默认 false）
  - db_alias: 数据库别名（可选）

返回:
  - 导出文件路径和行数`,
      inputSchema: ExportJsonSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const result = handleExportJson(dbState, params);
        return {
          content: [{
            type: "text",
            text: `已导出 ${result.row_count} 行到 ${result.file_path}`,
          }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: handleError(error) }] };
      }
    }
  );
}
