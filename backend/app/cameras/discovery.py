import asyncio
from urllib.parse import urlsplit
from ..config import get_settings
from ..schemas.camera import DiscoveryResult
from .onvif_client import inspect_onvif_device


async def discover_onvif_devices() -> list[DiscoveryResult]:
    if not get_settings().onvif_discovery_enabled:
        return []

    def scan() -> list[str]:
        try:
            from wsdiscovery.discovery import ThreadedWSDiscovery
        except ImportError:
            return []
        discovery = ThreadedWSDiscovery()
        discovery.start()
        try:
            addresses: list[str] = []
            for service in discovery.searchServices():
                address = next(iter(service.getXAddrs()), "")
                if address:
                    addresses.append(address)
            return list(dict.fromkeys(addresses))
        finally:
            discovery.stop()

    endpoints = await asyncio.to_thread(scan)
    results: list[DiscoveryResult] = []
    seen: set[str] = set()
    for endpoint in endpoints:
        parsed = urlsplit(endpoint)
        host = parsed.hostname
        if not host or host in seen:
            continue
        seen.add(host)
        port = parsed.port or 80
        device = await inspect_onvif_device(host, port, endpoint=endpoint)
        results.append(DiscoveryResult(ip=host, manufacturer=device.manufacturer, model=device.model, onvif_endpoint=endpoint, rtsp_url=device.rtsp_url, port=port, error=device.error))
    return results
