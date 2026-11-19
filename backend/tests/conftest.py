import os
import tempfile

storage = os.path.join(tempfile.gettempdir(), "localvision-test-storage")
os.environ.setdefault("SURVEILLANCE_WORKER_ENABLED", "false")
os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("STORAGE_PATH", storage)
os.environ.setdefault("ADMIN_USERNAME", "")
os.environ.setdefault("ADMIN_PASSWORD", "")
