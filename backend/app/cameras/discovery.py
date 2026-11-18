import asyncio
from urllib.parse import urlsplit
from ..config import get_settings
from ..schemas.camera import DiscoveryResult


async def discover_onvif_devices() -> list[DiscoveryResult]:
    if not get_settings().onvif_discovery_enabled:
        return []

    def scan() -> list[DiscoveryResult]:
        try:
            from wsdiscovery.discovery import ThreadedWSDiscovery
        except ImportError:
            return []
        discovery = ThreadedWSDiscovery()
        discovery.start()
        try:
            devices: list[DiscoveryResult] = []
            for service in discovery.searchServices():
                address = next(iter(service.getXAddrs()), "")
                host = urlsplit(address).hostname
                if host:
                    devices.append(DiscoveryResult(ip=host, onvif_endpoint=address))
            return devices
        finally:
            discovery.stop()

    return await asyncio.to_thread(scan)
