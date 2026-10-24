// SQLite integrado no Node (sem compilar nada). Requer Node 22.13 ou superior.
import { DatabaseSync } from "node:sqlite";

export const db = new DatabaseSync("medipath.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS symptoms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sintomas TEXT NOT NULL,
    inicio TEXT,
    intensidade INTEGER,
    descricao TEXT,
    nivel TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS medications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    dose TEXT NOT NULL,
    horario TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);
