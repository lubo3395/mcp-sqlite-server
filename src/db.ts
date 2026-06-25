import { DatabaseSync } from "node:sqlite";
import { resolve } from "path";
import type { DbState } from "./types.js";

export interface ConnectionArgs {
  dbPaths: string[];
  readonly: boolean;
  maxRows: number;
}

export function createDbState(args: ConnectionArgs): DbState {
  if (args.dbPaths.length === 0) {
    throw new Error("至少需要指定一个数据库文件路径（--db <path>）");
  }

  const mainPath = resolve(args.dbPaths[0]);

  const mainDb = new DatabaseSync(mainPath, {
    readOnly: args.readonly,
  });

  if (!args.readonly) {
    mainDb.exec("PRAGMA journal_mode = WAL");
  }
  mainDb.exec("PRAGMA foreign_keys = ON");

  const attachAliases: string[] = [];
  for (let i = 1; i < args.dbPaths.length; i++) {
    const alias = `db${i}`;
    const attachPath = resolve(args.dbPaths[i]);
    const escapedPath = attachPath.replace(/'/g, "''");
    mainDb.exec(`ATTACH DATABASE '${escapedPath}' AS ${alias}`);
    attachAliases.push(alias);
  }

  return {
    mainDb,
    dbPaths: args.dbPaths.map((p) => resolve(p)),
    readonly: args.readonly,
    attachAliases,
    maxRows: args.maxRows,
  };
}

export function closeDbState(dbState: DbState): void {
  dbState.mainDb.close();
}
