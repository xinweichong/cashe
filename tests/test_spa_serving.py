"""The SPA shell: signed-out visitors to / get the prerendered landing page."""
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

from src.storage import Storage, AdminStorage
from src.web.app import create_dashboard_app
from helpers import FakeUserManager, make_admin_db_with_user, TEST_USERNAME, TEST_PASSWORD


@pytest.fixture
def dist(tmp_path):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("app shell")
    (tmp_path / "landing.html").write_text("prerendered landing")
    return tmp_path


@pytest_asyncio.fixture
async def client(in_memory_db, dist):
    from src.web import auth as _auth
    admin_storage = AdminStorage(make_admin_db_with_user(TEST_PASSWORD))
    _auth.init_auth(admin_storage)
    app = create_dashboard_app(FakeUserManager(Storage(connection=in_memory_db)), admin_storage, static_dist=str(dist))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    _auth._admin_storage = None


@pytest.mark.asyncio
async def test_signed_out_root_gets_the_prerendered_landing_page(client):
    response = await client.get("/")
    assert response.text == "prerendered landing"
    assert response.headers["cache-control"] == "no-cache"
    assert "cookie" in response.headers["vary"].lower()


@pytest.mark.asyncio
async def test_signed_in_root_gets_the_app_shell(client):
    await client.post("/api/login", json={"username": TEST_USERNAME, "password": TEST_PASSWORD})
    assert (await client.get("/")).text == "app shell"


@pytest.mark.asyncio
async def test_a_stale_session_cookie_still_gets_the_landing_page(client):
    client.cookies.set("session", "not-a-session")
    assert (await client.get("/")).text == "prerendered landing"


@pytest.mark.asyncio
async def test_other_paths_get_the_app_shell_when_signed_out(client):
    assert (await client.get("/activity")).text == "app shell"
    assert (await client.get("/login")).text == "app shell"


@pytest.mark.asyncio
async def test_without_a_prerendered_page_root_falls_back_to_the_app_shell(client, dist):
    (dist / "landing.html").unlink()
    assert (await client.get("/")).text == "app shell"
