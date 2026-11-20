import logging
from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import AsyncEngine

logger = logging.getLogger(__name__)

TABLE_COLUMNS = {
    "events": {
        "description": ("TEXT", None),
        "track_id": ("VARCHAR(40)", None),
        "clip_path": ("TEXT", None),
    },
    "users": {
        "permissions": ("TEXT", "'{}'"),
        "is_active": ("BOOLEAN", "1"),
    },
    "cameras": {
        "owner_id": ("INTEGER", None),
    },
    "alerts": {
        "camera_id": ("INTEGER", None),
    },
}


async def ensure_runtime_columns(engine: AsyncEngine) -> None:
    async with engine.begin() as connection:
        tables = set(await connection.run_sync(lambda sync: inspect(sync).get_table_names()))
        for table, columns in TABLE_COLUMNS.items():
            if table not in tables:
                continue
            existing = {column["name"] for column in await connection.run_sync(lambda sync, name=table: inspect(sync).get_columns(name))}
            for name, (column_type, default_value) in columns.items():
                if name in existing:
                    continue
                statement = f"ALTER TABLE {table} ADD COLUMN {name} {column_type}"
                if default_value is not None:
                    statement += f" DEFAULT {default_value}"
                await connection.execute(text(statement))
                logger.info("Added %s.%s column", table, name)
        if {"cameras", "users"}.issubset(tables):
            await connection.execute(text("UPDATE cameras SET owner_id = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1) WHERE owner_id IS NULL"))


async def ensure_surveillance_columns(engine: AsyncEngine) -> None:
    await ensure_runtime_columns(engine)
