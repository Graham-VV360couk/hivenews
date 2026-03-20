"""Run all SQL migration files in order against the configured database.

Usage:
    python scripts/migrate.py

Requires DATABASE_URL in environment or .env file.
Each migration is wrapped in a transaction — partial failures are rolled back.
"""

import asyncio
import os
import sys
from pathlib import Path

import asyncpg
from dotenv import load_dotenv

load_dotenv()

MIGRATIONS_DIR = Path(__file__).parent.parent / "migrations"


async def run_migrations() -> None:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("ERROR: DATABASE_URL not set.", file=sys.stderr)
        sys.exit(1)

    conn = await asyncpg.connect(database_url)
    try:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS _migrations (
                filename   TEXT PRIMARY KEY,
                applied_at TIMESTAMPTZ DEFAULT NOW()
            )
        """)

        applied = {
            row["filename"]
            for row in await conn.fetch("SELECT filename FROM _migrations ORDER BY filename")
        }

        migration_files = sorted(MIGRATIONS_DIR.glob("*.sql"))
        if not migration_files:
            print("No migration files found.")
            return

        for path in migration_files:
            if path.name in applied:
                print(f"  skip  {path.name}")
                continue

            print(f"  apply {path.name} ...", end=" ", flush=True)
            sql = path.read_text()

            # Each migration runs in a transaction — partial failures roll back
            async with conn.transaction():
                await conn.execute(sql)
                await conn.execute(
                    "INSERT INTO _migrations (filename) VALUES ($1)", path.name
                )

            print("done")

        print("Migrations complete.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(run_migrations())
