"""Model catalog and installer. No real downloads: the child process is replaced by small scripts."""

import errno
import sys
import time
from collections import namedtuple

import pytest

from fvwks_voice import api, models
from fvwks_voice.errors import VoiceError

FAKE = models.ModelSpec("fake-model", "Fake", "asr", False, "Apache-2.0", "test",
                        (models.Repo("nobody/fake", "0" * 40, 1_000_000, ("config.json",)),))


@pytest.fixture
def fake_download(monkeypatch):
    """Point the installer at FAKE, with a scripted child and a byte counter that grows while it runs."""
    counter = {"n": 0}

    def fake_bytes(repo):
        counter["n"] += 250_000
        return min(counter["n"], repo.size_bytes)

    monkeypatch.setattr(models, "repo_dir", lambda repo: None)
    monkeypatch.setattr(models, "_repo_bytes", fake_bytes)

    def use(script: str) -> None:
        monkeypatch.setattr(models, "_DOWNLOAD", script)

    return use


def test_catalog_matches_the_server_and_app_ids():
    got = {m.id: m for m in api.list_models()}
    assert set(got) == {"kokoro-82m", "deepfilternet3", "whisper-aligner"}
    assert got["deepfilternet3"].required and got["deepfilternet3"].license == "MIT"
    assert not got["whisper-aligner"].required and got["whisper-aligner"].engine == "asr"
    assert got["whisper-aligner"].size_bytes == 1_613_979_758 + 4_618_475 + 1_276_475_979
    assert got["kokoro-82m"].required and got["kokoro-82m"].engine == "kokoro"


def test_kokoro_is_reported_installed_here():
    assert next(m for m in api.list_models() if m.id == "kokoro-82m").installed


def test_unknown_model():
    with pytest.raises(VoiceError) as e:
        api.install_model("nope", lambda f, m: None)
    assert e.value.code == "not_found" and e.value.status == 404


def test_installed_model_returns_at_once(monkeypatch):
    monkeypatch.setattr(models, "repo_dir", lambda repo: "/somewhere")
    calls = []
    models.install(FAKE, lambda f, m: calls.append(f))
    assert calls == [1.0]


def test_cancel_stops_the_download_and_propagates(fake_download):
    fake_download("import time\ntime.sleep(60)\n")

    class Cancelled(Exception):
        pass

    seen = []

    def progress(fraction, message):
        seen.append((fraction, message))
        if len(seen) == 3:
            raise Cancelled()

    t0 = time.monotonic()
    with pytest.raises(Cancelled):
        models.install(FAKE, progress, poll_s=0.05)
    assert time.monotonic() - t0 < 15  # the 60 s child was terminated, not waited for
    fractions = [f for f, _ in seen]
    assert fractions == sorted(fractions) and 0 < fractions[-1] < 1
    assert "Downloading Fake" in seen[0][1]


def test_failed_download_is_an_install_error(fake_download):
    fake_download("import sys\nprint('HTTP 404 for nobody/fake', file=sys.stderr)\nsys.exit(1)\n")
    with pytest.raises(VoiceError) as e:
        models.install(FAKE, None, poll_s=0.05)
    assert e.value.code == "install_failed" and "HTTP 404" in e.value.message


def test_full_disk_during_download_is_enospc(fake_download):
    fake_download("import sys\nprint('OSError: [Errno 28] No space left on device', file=sys.stderr)\nsys.exit(1)\n")
    with pytest.raises(OSError) as e:
        models.install(FAKE, None, poll_s=0.05)
    assert e.value.errno == errno.ENOSPC


def test_disk_check_before_download(fake_download, monkeypatch):
    Usage = namedtuple("Usage", "total used free")
    monkeypatch.setattr(models.shutil, "disk_usage", lambda p: Usage(10**12, 10**12, 2_000_000_000))
    with pytest.raises(VoiceError) as e:
        models.install(FAKE, None)
    assert e.value.code == "disk_full" and e.value.status == 507


# -- v0.4: installer fields, byte progress ------------------------------------------------------------


def test_installer_fields_when_installed_and_missing(monkeypatch):
    monkeypatch.setattr(models, "repo_dir", lambda repo: "/cache/snapshot")
    info = {m.id: m for m in api.list_models()}
    k = info["kokoro-82m"]
    assert (k.version, k.installed_version, k.update_available, k.install_needs_bytes) == ("1.0", "1.0", False, None)
    assert k.default_selected and not info["whisper-aligner"].default_selected
    # Not installed: what is left to download (a resumed download counts what is already there) plus the reserve.
    monkeypatch.setattr(models, "repo_dir", lambda repo: None)
    monkeypatch.setattr(models, "_repo_bytes", lambda repo: 100_000_000 if repo is models.WHISPER_REPO else 0)
    asr = next(m for m in api.list_models() if m.id == "whisper-aligner")
    assert not asr.installed and asr.installed_version is None and not asr.update_available
    assert asr.install_needs_bytes == models.ASR.size_bytes - 100_000_000 + models.DISK_RESERVE


def test_progress_reports_bytes_to_a_callback_that_takes_them(fake_download):
    fake_download("import time\ntime.sleep(0.4)\n")
    seen = []

    def progress(fraction=None, message=None, /, **info):
        seen.append((fraction, info))

    with pytest.raises(VoiceError):  # the scripted child downloads nothing, so the files are still missing
        models.install(FAKE, progress, poll_s=0.05)
    running = [info for f, info in seen if f is not None and f < 1]
    assert running and all(i["bytes_total"] == FAKE.size_bytes and i["current_item"] == "nobody/fake" for i in running)
    done = [i["bytes_done"] for i in running]
    assert done == sorted(done) and 0 < done[-1] <= FAKE.size_bytes


def test_disk_space_is_measured_where_the_cache_will_be(tmp_path, monkeypatch):
    fresh = tmp_path / "data" / "models" / "hub"  # a fresh Mac: HF_HOME doesn't exist yet
    Usage = namedtuple("Usage", "total used free")
    asked = []
    monkeypatch.setattr(models.shutil, "disk_usage", lambda p: asked.append(p) or Usage(1, 1, 123))
    assert models._disk_free(fresh) == 123
    assert asked == [tmp_path]


def test_model_not_installed_names_the_model():
    err = VoiceError("model_not_installed", "Recording transcription isn't installed.", status=503,
                     model_id="whisper-aligner")
    assert err.to_dict()["error"]["model_id"] == "whisper-aligner"
    assert "model_id" not in VoiceError("tts_failed", "x").to_dict()["error"]


def test_kokoro_loads_from_a_pinned_download_without_refs_main(tmp_path, monkeypatch):
    """A fresh Mac's cache: the installer fetched the pinned revision, which writes no refs/main (S3's DMG repro)."""
    from huggingface_hub import constants

    from fvwks_voice.tts_kokoro import WEIGHTS_FILE, KokoroEngine

    monkeypatch.setattr(constants, "HF_HUB_CACHE", str(tmp_path))
    snap = tmp_path / "models--mlx-community--Kokoro-82M-bf16" / "snapshots" / models.KOKORO_REPO.revision
    for name in (*models.KOKORO_REPO.required_files, WEIGHTS_FILE):
        (snap / name).parent.mkdir(parents=True, exist_ok=True)
        (snap / name).write_bytes(b"x")
    assert not (snap.parent.parent / "refs").exists()
    engine = KokoroEngine()
    assert engine.model_dir() == snap and engine.is_installed("am_fenrir")
    assert next(m for m in api.list_models() if m.id == "kokoro-82m").installed


@pytest.mark.skipif(sys.platform != "darwin", reason="APFS clones")
def test_reuses_a_complete_copy_already_on_this_mac(tmp_path, monkeypatch):
    from huggingface_hub import constants

    ours, other = tmp_path / "ours", tmp_path / "other"
    ours.mkdir()
    monkeypatch.setattr(constants, "HF_HUB_CACHE", str(ours))
    monkeypatch.setattr(models, "_other_caches", lambda: [other])
    rev = "a" * 40
    repo = models.Repo("org/tiny", rev, 11, ("config.json", "w/model.bin"))
    spec = models.ModelSpec("tiny", "Tiny", "kokoro", False, "MIT", "", (repo,))
    # Another cache holds the pinned snapshot in the hub's layout: blobs, and the snapshot's links to them.
    blobs = other / "models--org--tiny" / "blobs"
    snap = other / "models--org--tiny" / "snapshots" / rev
    blobs.mkdir(parents=True)
    (snap / "w").mkdir(parents=True)
    (blobs / "h1").write_bytes(b"{}{}{}")
    (blobs / "h2").write_bytes(b"1234")  # short: the sizes don't add up to the pin
    (snap / "config.json").symlink_to("../../blobs/h1")
    (snap / "w" / "model.bin").symlink_to("../../../blobs/h2")
    assert models.repo_dir(repo) is None  # not trusted: it downloads as before
    (blobs / "h2").write_bytes(b"12345")

    said = []
    models.install(spec, lambda fraction, message: said.append(message))
    assert said == ["Found Tiny on this Mac."]  # cloned, nothing downloaded
    found = models.repo_dir(repo)
    assert found == ours / "models--org--tiny" / "snapshots" / rev
    assert (found / "w" / "model.bin").read_bytes() == b"12345"
    assert (found / "config.json").is_symlink() and (ours / "models--org--tiny" / "blobs" / "h1").is_file()
