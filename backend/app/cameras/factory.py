from ..models.camera import Camera
from .base import CameraProvider
from .hls import HLSProvider
from .http import HTTPProvider
from .onvif import ONVIFProvider
from .rtsp import RTSPProvider


def provider_for(camera: Camera) -> CameraProvider:
    if camera.protocol == "ONVIF": return ONVIFProvider(camera)
    if camera.protocol in {"HTTP", "MJPEG"}: return HTTPProvider(camera)
    if camera.protocol == "HLS": return HLSProvider(camera)
    return RTSPProvider(camera)
