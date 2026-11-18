from datetime import datetime
from sqlalchemy import Boolean, DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column
from ..database import Base


class Camera(Base):
    __tablename__ = "cameras"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    location: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    manufacturer: Mapped[str] = mapped_column(String(80), default="Generic", nullable=False)
    model: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    host: Mapped[str] = mapped_column(String(255), nullable=False)
    port: Mapped[int] = mapped_column(Integer, default=554, nullable=False)
    protocol: Mapped[str] = mapped_column(String(20), default="RTSP", nullable=False)
    rtsp_url: Mapped[str | None] = mapped_column(Text)
    onvif_url: Mapped[str | None] = mapped_column(Text)
    username: Mapped[str | None] = mapped_column(String(120))
    encrypted_password: Mapped[str | None] = mapped_column(Text)
    main_stream: Mapped[str | None] = mapped_column(Text)
    sub_stream: Mapped[str | None] = mapped_column(Text)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    recording_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    ai_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
