import shutil
from dataclasses import dataclass


@dataclass(frozen=True)
class HardwareAcceleration:
    backend: str
    encoder: str | None
    available: bool


def detect_hardware() -> list[HardwareAcceleration]:
    options = [
        HardwareAcceleration("nvidia", "h264_nvenc", bool(shutil.which("nvidia-smi"))),
        HardwareAcceleration("vaapi", "h264_vaapi", bool(shutil.which("vainfo"))),
        HardwareAcceleration("cpu", "libx264", bool(shutil.which("ffmpeg"))),
    ]
    return options
