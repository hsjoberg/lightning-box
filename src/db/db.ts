import sqlite3 from "sqlite3";
import { Database, open } from "sqlite";
import config from "../../config/config";

let db: Database | null = null;

export default async function getDb(forceReopen: boolean = false) {
  if (db && !forceReopen) {
    return db;
  }

  db = await open({
    filename: config.env === "test" ? ":memory:" : "./database.db",
    driver: sqlite3.Database,
  });
  await db.migrate();

  if (config.env === "development") {
    sqlite3.verbose();
  }

  return db;
}

export async function beginTransaction(db: Database) {
  await db.run("BEGIN TRANSACTION");
  return;
}

export async function commit(db: Database) {
  await db.run("COMMIT");
  return;
}
