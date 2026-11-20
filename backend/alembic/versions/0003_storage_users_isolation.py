from alembic import op
import sqlalchemy as sa

revision = "0003_storage_users_isolation"
down_revision = "0002_surveillance"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("permissions", sa.JSON(), nullable=False, server_default="{}"))
        batch.add_column(sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()))
    with op.batch_alter_table("cameras") as batch:
        batch.add_column(sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True))
    with op.batch_alter_table("alerts") as batch:
        batch.add_column(sa.Column("camera_id", sa.Integer(), sa.ForeignKey("cameras.id", ondelete="SET NULL"), nullable=True))
    op.execute("UPDATE cameras SET owner_id = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1) WHERE owner_id IS NULL")
    op.create_table(
        "storage_integrations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("kind", sa.String(40), nullable=False),
        sa.Column("endpoint", sa.Text(), nullable=False),
        sa.Column("base_path", sa.Text(), nullable=True),
        sa.Column("bucket", sa.String(120), nullable=True),
        sa.Column("region", sa.String(120), nullable=True),
        sa.Column("auth_method", sa.String(30), nullable=False, server_default="none"),
        sa.Column("encrypted_secret", sa.Text(), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("last_status", sa.String(30), nullable=False, server_default="untested"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("last_checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("storage_integrations")
    with op.batch_alter_table("alerts") as batch:
        batch.drop_column("camera_id")
    with op.batch_alter_table("cameras") as batch:
        batch.drop_column("owner_id")
    with op.batch_alter_table("users") as batch:
        batch.drop_column("is_active")
        batch.drop_column("permissions")
