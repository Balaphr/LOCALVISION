import logging
from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import AsyncEngine

logger = logging.getLogger(__name__)

EVENT_COLUMNS = {
    "description": "TEXT",
    "track_id": "VARCHAR(40)",
    "clip_path": "TEXT",
}


async def ensure_surveillance_columns(engine: AsyncEngine) -> None:
    async with engine.begin() as connection:
        columns = {column["name"] for column in await connection.run_sync(lambda sync: inspect(sync).get_columns("events"))}
        for name, column_type in EVENT_COLUMNS.items():
            if name not in columns:
                await connection.execute(text(f"ALTER TABLE events ADD COLUMN {name} {column_type}"))
                logger.info("Added events.%s column", name)
