import { existsSync, statSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import type { ColumnDef } from "./types.js";

export function isReadOnlyStatement(sql: string): boolean {
  const trimmed = sql.trim().toUpperCase();
  return /^\s*(SELECT|PRAGMA|EXPLAIN|WITH)\b/.test(trimmed);
}

export function formatResultsAsTable(columns: string[], rows: unknown[][]): string {
  if (columns.length === 0) return "（空结果集）";

  const colWidths = columns.map((h, i) => {
    const headerLen = h.length;
    const maxDataLen = rows.reduce((max, row) => {
      const val = i < row.length ? String(row[i] ?? "NULL") : "";
      return Math.max(max, val.length);
    }, 0);
    return Math.max(headerLen, maxDataLen, 3);
  });

  const lines: string[] = [];
  lines.push("| " + columns.map((h, i) => h.padEnd(colWidths[i])).join(" | ") + " |");
  lines.push("| " + colWidths.map((w) => "-".repeat(w)).join(" | ") + " |");

  const displayRows = rows.slice(0, 200);
  for (const row of displayRows) {
    lines.push("| " + colWidths.map((w, i) => {
      const val = i < row.length ? String(row[i] ?? "NULL") : "";
      return val.padEnd(w);
    }).join(" | ") + " |");
  }
  if (rows.length > 200) {
    lines.push("");
    lines.push(`*仅显示前 200 行，共 ${rows.length} 行*`);
  }
  return lines.join("\n");
}

export function handleError(error: unknown): string {
  if (error instanceof Error) {
    return `错误: ${error.message}`;
  }
  return `错误: ${String(error)}`;
}

export function resolveFilePath(filePath: string): string {
  const resolved = resolve(filePath);
  if (!existsSync(resolved)) {
    throw new Error(`文件不存在: ${resolved}`);
  }
  if (!statSync(resolved).isFile()) {
    throw new Error(`路径不是文件: ${resolved}`);
  }
  return resolved;
}

export function checkOutputPath(filePath: string, overwrite: boolean): string {
  const resolved = resolve(filePath);
  if (existsSync(resolved) && !overwrite) {
    throw new Error(`文件已存在: ${resolved}\n请设置 overwrite=true 覆盖，或使用不同的文件路径`);
  }
  const dir = dirname(resolved);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return resolved;
}

export function safeJsonParse<T>(str: string): T {
  try {
    return JSON.parse(str) as T;
  } catch {
    throw new Error("JSON 格式无效，请检查输入");
  }
}

export function buildColumnDefs(columns: ColumnDef[]): string {
  return columns.map((col) => {
    const parts: string[] = [`"${col.name}"`, col.type];
    if (col.primaryKey) parts.push("PRIMARY KEY");
    if (col.autoIncrement && col.type?.toUpperCase() === "INTEGER") parts.push("AUTOINCREMENT");
    if (col.notnull) parts.push("NOT NULL");
    if (col.unique) parts.push("UNIQUE");
    if (col.defaultValue !== undefined) parts.push(`DEFAULT ${col.defaultValue}`);
    return parts.join(" ");
  }).join(", ");
}

function escapeCsvField(value: string, delimiter: string): string {
  if (value.includes('"') || value.includes(delimiter) || value.includes("\n") || value.includes("\r")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function parseCsv(text: string, delimiter: string, hasHeader: boolean): {
  headers: string[];
  rows: string[][];
} {
  const lines: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === "\n") {
        if (current.length > 0 || lines.length > 0) {
          lines.push(current);
        }
        current = "";
      } else if (ch === "\r") {
        // skip
      } else {
        current += ch;
      }
    }
  }
  if (current.length > 0 || lines.length > 0) {
    lines.push(current);
  }

  const parsed = lines.map((line) => {
    const fields: string[] = [];
    let field = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQ = false;
          }
        } else {
          field += ch;
        }
      } else {
        if (ch === '"') {
          inQ = true;
        } else if (ch === delimiter) {
          fields.push(field);
          field = "";
        } else {
          field += ch;
        }
      }
    }
    fields.push(field);
    return fields;
  });

  if (parsed.length === 0) {
    return { headers: [], rows: [] };
  }

  if (hasHeader) {
    return { headers: parsed[0], rows: parsed.slice(1) };
  }
  return {
    headers: parsed[0].map((_, i) => `col${i + 1}`),
    rows: parsed,
  };
}

export function inferType(value: string): string {
  if (value === "" || value === null || value === undefined) return "TEXT";
  if (/^-?\d+$/.test(value)) return "INTEGER";
  if (/^-?\d+\.\d+$/.test(value)) return "REAL";
  return "TEXT";
}

export function formatCsvRow(fields: unknown[], delimiter: string): string {
  return fields.map((f) => {
    const s = f === null || f === undefined ? "" : String(f);
    return escapeCsvField(s, delimiter);
  }).join(delimiter);
}

export function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
