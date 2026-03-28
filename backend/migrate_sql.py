import os
import sys
import psycopg2


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python backend/migrate_sql.py path/to/file.sql [more.sql]")
        return 1

    conn_str = os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL")
    if not conn_str:
        print("Missing SUPABASE_DB_URL or DATABASE_URL in environment")
        return 1

    try:
        conn = psycopg2.connect(conn_str)
    except Exception as exc:
        print(f"Failed to connect: {exc}")
        return 1

    try:
        with conn:
            with conn.cursor() as cur:
                for path in sys.argv[1:]:
                    with open(path, "r", encoding="utf-8") as handle:
                        sql = handle.read()
                    print(f"Applying {path}...")
                    cur.execute(sql)
                    print(f"Applied {path}")
    finally:
        conn.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
