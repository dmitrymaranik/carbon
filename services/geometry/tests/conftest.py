from pathlib import Path

import pytest


@pytest.fixture(scope="session")
def step_fixtures(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    """Generate the STEP fixtures once per session (requires OCP)."""
    pytest.importorskip("OCP")
    from fixtures.make_fixtures import build_all

    return build_all(tmp_path_factory.mktemp("step-fixtures"))
