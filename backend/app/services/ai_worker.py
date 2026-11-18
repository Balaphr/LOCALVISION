import asyncio


async def run() -> None:
    while True:
        await asyncio.sleep(5)


if __name__ == "__main__":
    asyncio.run(run())
