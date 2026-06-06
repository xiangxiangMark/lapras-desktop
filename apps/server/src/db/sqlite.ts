import { DatabaseSync } from "node:sqlite";

export interface Statement<Result = unknown> {
  run(params?: unknown): Result;
  get(params?: unknown): Result | undefined;
  all(params?: unknown): Result[];
}

export interface DatabaseClient {
  pragma(source: string): void;
  exec(source: string): void;
  prepare<Result = unknown>(source: string): Statement<Result>;
  transaction<TArgs extends unknown[] = [], TResult = unknown>(
    fn: (...args: TArgs) => TResult
  ): (...args: TArgs) => TResult;
}

class SqliteStatement<Result = unknown> implements Statement<Result> {
  constructor(private readonly statement: ReturnType<DatabaseSync["prepare"]>) {}

  run(params?: unknown) {
    const statement = this.statement as {
      run: (...args: unknown[]) => unknown;
    };

    return (params === undefined
      ? statement.run()
      : Array.isArray(params)
        ? statement.run(...params)
      : statement.run(params)) as Result;
  }

  get(params?: unknown) {
    const statement = this.statement as {
      get: (...args: unknown[]) => unknown;
    };

    return (params === undefined
      ? statement.get()
      : Array.isArray(params)
        ? statement.get(...params)
      : statement.get(params)) as Result | undefined;
  }

  all(params?: unknown) {
    const statement = this.statement as {
      all: (...args: unknown[]) => unknown[];
    };

    return (params === undefined
      ? statement.all()
      : Array.isArray(params)
        ? statement.all(...params)
      : statement.all(params)) as Result[];
  }
}

export class SqliteDatabaseClient implements DatabaseClient {
  private readonly db: DatabaseSync;

  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
  }

  pragma(source: string) {
    this.db.exec(`PRAGMA ${source}`);
  }

  exec(source: string) {
    this.db.exec(source);
  }

  prepare<Result = unknown>(source: string): Statement<Result> {
    return new SqliteStatement<Result>(this.db.prepare(source));
  }

  transaction<TArgs extends unknown[] = [], TResult = unknown>(
    fn: (...args: TArgs) => TResult
  ) {
    return (...args: TArgs) => {
      this.db.exec("BEGIN");

      try {
        const result = fn(...args);
        this.db.exec("COMMIT");
        return result;
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    };
  }
}
