import asyncio
from .surveillance import surveillance_worker


async def run() -> None:
    await surveillance_worker.start()
    try:
        while surveillance_worker.running:
            await asyncio.sleep(1)
    finally:
        await surveillance_worker.stop()


if __name__ == "__main__":
    asyncio.run(run())
