import asyncio
from dataclasses import dataclass


@dataclass(frozen=True)
class OnvifDevice:
    ip: str
    endpoint: str
    manufacturer: str | None = None
    model: str | None = None
    rtsp_url: str | None = None
    error: str | None = None


def _device_sync(host: str, port: int, username: str | None, password: str | None, endpoint: str | None) -> OnvifDevice:
    try:
        from onvif import ONVIFCamera
    except ImportError:
        return OnvifDevice(host, endpoint or "", error="ONVIF support is not installed")
    xaddr = endpoint or f"http://{host}:{port}/onvif/device_service"
    try:
        camera = ONVIFCamera(host, port, username or "", password or "")
        info = {}
        try:
            device_service = camera.create_devicemgmt_service()
            info = device_service.to_dict(device_service.GetDeviceInformation()) or {}
        except Exception:
            info = {}
        stream_url = None
        try:
            media_service = camera.create_media_service()
            profiles = media_service.GetProfiles() or []
            if profiles:
                token = profiles[0].token
                setup = media_service.create_type("GetStreamUri")
                setup.StreamSetup = {"Stream": "RTP-Unicast", "Transport": {"Protocol": "RTSP"}}
                setup.ProfileToken = token
                result = media_service.GetStreamUri(setup)
                raw = str(result.Uri)
                if username and "@" not in raw:
                    from urllib.parse import quote, urlsplit, urlunsplit
                    parts = urlsplit(raw)
                    netloc = f"{quote(username, safe='')}:{quote(password or '', safe='')}@{parts.netloc}"
                    stream_url = urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))
                else:
                    stream_url = raw
        except Exception:
            stream_url = None
        return OnvifDevice(
            ip=host,
            endpoint=xaddr,
            manufacturer=info.get("Manufacturer"),
            model=info.get("Model"),
            rtsp_url=stream_url,
        )
    except Exception as error:
        return OnvifDevice(host, xaddr, error=str(error))


async def inspect_onvif_device(host: str, port: int = 80, username: str | None = None, password: str | None = None, endpoint: str | None = None) -> OnvifDevice:
    return await asyncio.wait_for(asyncio.to_thread(_device_sync, host, port, username, password, endpoint), timeout=15)
