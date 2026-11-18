from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=255)
    remember_me: bool = False


class UserRead(BaseModel):
    id: int
    username: str
    role: str


class LoginResponse(BaseModel):
    user: UserRead
    authenticated: bool = True


class UserCreate(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=255)
    role: str = Field(default="viewer")
