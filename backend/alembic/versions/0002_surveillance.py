from alembic import op
import sqlalchemy as sa

revision = "0002_surveillance"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("events") as batch:
        batch.add_column(sa.Column("description", sa.Text(), nullable=True))
        batch.add_column(sa.Column("track_id", sa.String(40), nullable=True))
        batch.add_column(sa.Column("clip_path", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("events") as batch:
        batch.drop_column("clip_path")
        batch.drop_column("track_id")
        batch.drop_column("description")
