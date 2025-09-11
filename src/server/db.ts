import Database from "better-sqlite3";

export type UserRow = {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
};

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  db = new Database(process.env.SQLITE_PATH || "./data.sqlite");
  db.pragma("journal_mode = WAL");
  migrate(db);
  return db;
}

function migrate(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      passwordHash TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      name TEXT NOT NULL,
      mime TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY(userId) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      documentId TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding TEXT NOT NULL,
      FOREIGN KEY(documentId) REFERENCES documents(id)
    );

    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY(userId) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chatId TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY(chatId) REFERENCES chats(id)
    );

    CREATE TABLE IF NOT EXISTS tests (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      mode TEXT NOT NULL,
      durationSec INTEGER NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY(userId) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS test_questions (
      id TEXT PRIMARY KEY,
      testId TEXT NOT NULL,
      type TEXT NOT NULL,
      question TEXT NOT NULL,
      options TEXT,
      answerKey TEXT,
      maxScore REAL NOT NULL,
      FOREIGN KEY(testId) REFERENCES tests(id)
    );

    CREATE TABLE IF NOT EXISTS test_submissions (
      id TEXT PRIMARY KEY,
      testId TEXT NOT NULL,
      userId TEXT NOT NULL,
      startedAt TEXT NOT NULL,
      submittedAt TEXT,
      score REAL,
      FOREIGN KEY(testId) REFERENCES tests(id),
      FOREIGN KEY(userId) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS test_answers (
      id TEXT PRIMARY KEY,
      submissionId TEXT NOT NULL,
      questionId TEXT NOT NULL,
      answer TEXT NOT NULL,
      scoreAwarded REAL,
      FOREIGN KEY(submissionId) REFERENCES test_submissions(id),
      FOREIGN KEY(questionId) REFERENCES test_questions(id)
    );
  `);
}


