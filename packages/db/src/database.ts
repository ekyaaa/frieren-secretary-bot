/**
 * Database client and migration runner for Frieren Discord Logbook.
 * Uses Node.js 22 built-in node:sqlite with synchronous prepared statements and transactions.
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export class Database {
  public db: DatabaseSync;

  constructor(dbPath: string = ':memory:') {
    if (dbPath !== ':memory:') {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    this.db = new DatabaseSync(dbPath);
    this.initPragmas();
    this.migrate();
  }

  private initPragmas(): void {
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA journal_mode = WAL;');
  }

  private migrate(): void {
    const schemaPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      const sql = fs.readFileSync(schemaPath, 'utf8');
      this.db.exec(sql);
    }
  }

  public exec(sql: string): void {
    this.db.exec(sql);
  }

  public prepare(sql: string) {
    return this.db.prepare(sql);
  }

  public transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN TRANSACTION');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  public close(): void {
    this.db.close();
  }
}
