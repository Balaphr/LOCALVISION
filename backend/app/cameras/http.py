from .rtsp import RTSPProvider


class HTTPProvider(RTSPProvider):
    """HTTP/MJPEG camera provider slot; transport implementation stays behind the provider interface."""
