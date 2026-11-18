from .rtsp import RTSPProvider


class HLSProvider(RTSPProvider):
    """HLS camera provider slot for cameras exposing a local HLS playlist."""
