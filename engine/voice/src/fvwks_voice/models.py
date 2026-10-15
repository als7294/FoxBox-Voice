"""Installable voice models: what's on disk, how big it is, and how to fetch it.

- kokoro-82m (required): Kokoro-82M on MLX, the config, weights and the 28 English voices.
- deepfilternet3 (required, 8.7 MB): denoises recordings at ingest.
- whisper-aligner (opt-in): word timings for recordings (Whisper large-v3-turbo + Qwen3-ForcedAligner).

Revisions are pinned, so an install is reproducible and ENGINE_VERSION means something. A pinned snapshot that is
already complete elsewhere on this Mac (the standard Hugging Face cache, another FoxBox data dir) is cloned into ours
(APFS clones: instant, no extra disk) instead of downloaded again.
Downloads run in a child process: a cancel really stops the transfer (a thread can't be killed), and the
partial files stay in the Hugging Face cache, so the next install resumes where it stopped.
"""

from __future__ import annotations

import errno
import inspect
import json
import os
import shutil
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from fnmatch import fnmatch
from pathlib import Path
from typing import Any, Callable

from fvwks_contracts.models import ModelInfo

from .errors import VoiceError

DISK_RESERVE = 5_000_000_000  # must stay free after a download
BUILTIN_VERSION = "1.0"  # the version of the pins this engine build ships with
# progress(fraction, message, *, bytes_done, bytes_total, current_item): the keywords go only to a callback
# that takes **kwargs (the server's does since v0.4).
Progress = Callable[..., None]


@dataclass(frozen=True)
class Repo:
    repo_id: str
    revision: str
    size_bytes: int
    required_files: tuple[str, ...]
    allow_patterns: tuple[str, ...] | None = None


@dataclass(frozen=True)
class ModelSpec:
    id: str
    name: str
    engine: str
    required: bool
    license: str
    description: str
    repos: tuple[Repo, ...]
    version: str = BUILTIN_VERSION

    @property
    def size_bytes(self) -> int:
        return sum(r.size_bytes for r in self.repos)


KOKORO_REPO = Repo(
    "mlx-community/Kokoro-82M-bf16", "a71e4d38b236d968966a2002c4c895dbd12b1c3c", 341_742_463,
    ("config.json", "kokoro-v1_0.safetensors", "voices/am_fenrir.safetensors", "voices/bm_george.safetensors"),
    ("config.json", "kokoro-v1_0.safetensors", "voices/a*.safetensors", "voices/b*.safetensors"))
KOKORO = ModelSpec(
    "kokoro-82m", "Kokoro 82M", "kokoro", True, "Apache-2.0",
    "Default fast TTS on the Apple GPU: 28 English voices.", (KOKORO_REPO,))
DF3_REPO = Repo("mlx-community/DeepFilterNet-mlx", "220d5dfb7266352272d74c2a7d2025c59e07b391", 8_683_690,
                ("v3/config.json", "v3/model.safetensors"), ("v3/*",))
DENOISE = ModelSpec(
    "deepfilternet3", "DeepFilterNet3 denoiser", "denoise", True, "MIT",
    "Cleans recordings before the mask: room noise, hum and hiss. 8.7 MB.", (DF3_REPO,))
WHISPER_REPO = Repo("mlx-community/whisper-large-v3-turbo", "a4aaeec0636e6fef84abdcbe3544cb2bf7e9f6fb",
                    1_613_979_758, ("config.json", "weights.safetensors"))
# The MLX conversion ships no tokenizer; Whisper's own (MIT) is loaded next to it.
WHISPER_TOKENIZER_REPO = Repo("openai/whisper-large-v3-turbo", "41f01f3fe87f28c78e2fbf8b568835947dd65ed9",
                              4_618_475, ("tokenizer.json", "preprocessor_config.json", "tokenizer_config.json",
                                          "vocab.json", "merges.txt"), ("*.json", "*.txt"))
ALIGNER_REPO = Repo("mlx-community/Qwen3-ForcedAligner-0.6B-8bit", "0e1a68e91d815300c7c9754b2a7639378b23db15",
                    1_276_475_979, ("config.json", "model.safetensors"))
ASR = ModelSpec(
    "whisper-aligner", "Recording transcription", "asr", False, "MIT (Whisper) + Apache-2.0 (Qwen3-ForcedAligner)",
    "Transcribes recordings (Whisper large-v3-turbo) and places every word (Qwen3-ForcedAligner), so throws "
    "hit exact words and the transcript can be edited.", (WHISPER_REPO, WHISPER_TOKENIZER_REPO, ALIGNER_REPO))
MODELS: dict[str, ModelSpec] = {m.id: m for m in (KOKORO, DENOISE, ASR)}

_lock = threading.RLock()


def _cache_root() -> Path:
    from huggingface_hub import constants

    return Path(constants.HF_HUB_CACHE)


def _cached_dir(repo: Repo) -> Path | None:
    from huggingface_hub import try_to_load_from_cache

    found = [try_to_load_from_cache(repo.repo_id, f, revision=repo.revision) for f in repo.required_files]
    if not all(isinstance(p, str) and Path(p).exists() for p in found):
        return None
    return Path(found[0]).parent


def repo_dir(repo: Repo) -> Path | None:
    """The folder holding the first required file (usually the snapshot root) when every required file is cached
    (no network). A complete copy elsewhere on this Mac is cloned in first (see _adopt)."""
    found = _cached_dir(repo)
    if found is None and _adopt(repo):
        found = _cached_dir(repo)
    return found


# -- reuse what this Mac already has (1.1.1) ------------------------------------------------------------
def _other_caches() -> list[Path]:
    """Hugging Face hub caches on this Mac besides ours: the standard one (and $HF_HUB_CACHE / $HF_HOME) and the
    other FoxBox data dirs' (<data>/models/hub)."""
    home = Path.home()
    places = [Path(p) for p in (os.environ.get("HF_HUB_CACHE"),) if p]
    if os.environ.get("HF_HOME"):
        places.append(Path(os.environ["HF_HOME"]) / "hub")
    places.append(home / ".cache" / "huggingface" / "hub")
    places += sorted((home / "Library" / "Application Support").glob("FoxBox*/models/hub"))
    ours = _cache_root().resolve()
    out: list[Path] = []
    for p in places:
        try:
            p = p.resolve()
        except OSError:
            continue
        if p != ours and p.is_dir() and p not in out:
            out.append(p)
    return out


def _complete_snapshot(cache: Path, repo: Repo) -> dict[str, Path] | None:
    """The pinned snapshot's files in `cache` (path in the repo → file) when it is complete: every required file is
    there, and the files the install would download add up to exactly the pinned size."""
    snap = cache / f"models--{repo.repo_id.replace('/', '--')}" / "snapshots" / repo.revision
    if not snap.is_dir():
        return None
    files: dict[str, Path] = {}
    total = 0
    try:
        for p in snap.rglob("*"):
            name = p.relative_to(snap).as_posix()
            if not p.is_file() or (repo.allow_patterns and not any(fnmatch(name, pat) for pat in repo.allow_patterns)):
                continue  # folders, broken links (a blob that never finished), files the install doesn't fetch
            total += p.stat().st_size
            files[name] = p
    except OSError:
        return None
    if total != repo.size_bytes or not all(f in files for f in repo.required_files):
        return None
    return files


def _clone(src: Path, dst: Path) -> None:
    """An APFS clone: nothing is copied and no disk is used until one side changes. Raises where it can't clone
    (another volume, another file system)."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["cp", "-c", str(src), str(dst)], check=True, capture_output=True)


def _adopt(repo: Repo) -> bool:
    """Clone a complete copy of the pinned snapshot from another cache on this Mac into ours, in the hub's layout
    (blobs, and the snapshot's links to them), so the pinned revision resolves without a download. False, leaving
    nothing behind, when there is no complete copy or it can't be cloned (then it downloads as before)."""
    if sys.platform != "darwin":
        return False
    with _lock:
        for other in _other_caches():
            files = _complete_snapshot(other, repo)
            if files is None:
                continue
            ours = _cache_root() / f"models--{repo.repo_id.replace('/', '--')}"
            snap = ours / "snapshots" / repo.revision
            made: list[Path] = []
            try:
                for name, src in files.items():
                    dst = snap / name
                    if dst.exists():
                        continue
                    if dst.is_symlink():
                        dst.unlink()  # a link to a blob that never finished
                    real = src.resolve()
                    if src.is_symlink() and real.parent.name == "blobs":
                        blob = ours / "blobs" / real.name
                        if not blob.exists():
                            _clone(real, blob)
                            made.append(blob)
                        dst.parent.mkdir(parents=True, exist_ok=True)
                        dst.symlink_to(os.path.relpath(blob, dst.parent))
                    else:
                        _clone(real, dst)
                    made.append(dst)
                return True
            except (OSError, subprocess.CalledProcessError):
                for p in reversed(made):
                    p.unlink(missing_ok=True)
    return False


# -- what's installed -----------------------------------------------------------------------------
def is_installed(spec: ModelSpec) -> bool:
    return all(repo_dir(r) is not None for r in spec.repos)


def repo_path(spec: ModelSpec, repo: Repo) -> Path | None:
    """Where the loaders find `repo`, or None if the model isn't completely installed."""
    return repo_dir(repo) if is_installed(spec) else None


def _repo_bytes(repo: Repo) -> int:
    """Bytes of the pinned snapshot already on disk, counting partial downloads."""
    root = _cache_root() / f"models--{repo.repo_id.replace('/', '--')}"
    total = sum(p.stat().st_size for p in (root / "blobs").glob("*.incomplete")) if (root / "blobs").exists() else 0
    snap = root / "snapshots" / repo.revision
    if snap.exists():
        total += sum(p.stat().st_size for p in snap.rglob("*") if p.is_file())
    return total


def _left_bytes(spec: ModelSpec) -> int:
    return sum(max(0, r.size_bytes - _repo_bytes(r)) for r in spec.repos if repo_dir(r) is None)


def model_info(spec: ModelSpec) -> ModelInfo:
    installed = is_installed(spec)
    return ModelInfo(
        id=spec.id, name=spec.name, engine=spec.engine, size_bytes=spec.size_bytes, installed=installed,
        required=spec.required, license=spec.license, description=spec.description,
        version=spec.version, installed_version=spec.version if installed else None,
        # The installer pre-ticks what ships by default; the opt-ins stay unticked.
        default_selected=spec.required,
        # What the install still downloads, a resumed one counting what's already there, plus the reserve.
        install_needs_bytes=None if installed else _left_bytes(spec) + DISK_RESERVE,
    )


def _disk_free(path: Path) -> int:
    """Free space where `path` is, or would be (a fresh Mac has no model cache yet)."""
    p = Path(path)
    while not p.exists() and p != p.parent:
        p = p.parent
    return shutil.disk_usage(p).free


# -- install ------------------------------------------------------------------------------
_DOWNLOAD = """
import json, sys
from huggingface_hub import snapshot_download
repo, rev, patterns = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
snapshot_download(repo, revision=rev, allow_patterns=patterns)
"""


def _stop(proc: subprocess.Popen) -> None:
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()


def _reporter(progress: Progress | None) -> Callable[..., None]:
    """progress() with the byte counts as keywords when the callback takes **kwargs, else just (fraction, message)."""
    if progress is None:
        return lambda fraction, message, **info: None
    try:
        keywords = any(p.kind is inspect.Parameter.VAR_KEYWORD for p in inspect.signature(progress).parameters.values())
    except (TypeError, ValueError):
        keywords = False

    def report(fraction: float | None, message: str | None, **info: Any) -> None:
        if keywords:
            progress(fraction, message, **info)
        else:
            progress(fraction, message)

    return report


def install(spec: ModelSpec, progress: Progress | None = None, *, poll_s: float = 0.5) -> None:
    """Download every missing repo of the model. `progress(fraction, message, bytes_done=, bytes_total=,
    current_item=)` is called from this thread; if it raises (the user cancelled), the download is stopped and the
    exception propagates."""
    report = _reporter(progress)
    found = [r for r in spec.repos if _cached_dir(r) is None and _adopt(r)]
    missing = [r for r in spec.repos if repo_dir(r) is None]
    total = spec.size_bytes
    if not missing:
        message = f"Found {spec.name} on this Mac." if found else f"{spec.name} is installed."
        report(1.0, message, bytes_done=total, bytes_total=total, current_item=None)
        return
    if found:
        done = sum(r.size_bytes for r in found)
        report(done / total, f"Found part of {spec.name} on this Mac.", bytes_done=done, bytes_total=total,
               current_item=None)
    need = sum(max(0, r.size_bytes - _repo_bytes(r)) for r in missing)
    free = _disk_free(_cache_root())
    if free < need + DISK_RESERVE:
        raise VoiceError("disk_full", f"{spec.name} needs {need / 1e9:.1f} GB and {DISK_RESERVE / 1e9:.0f} GB must "
                         f"stay free; {free / 1e9:.1f} GB is available.",
                         f"Free up at least {(need + DISK_RESERVE - free) / 1e9:.1f} GB, then try again.", status=507)
    for repo in missing:
        patterns = list(repo.allow_patterns) if repo.allow_patterns else None
        env = {**os.environ, "HF_HUB_DISABLE_PROGRESS_BARS": "1"}
        proc = subprocess.Popen([sys.executable, "-c", _DOWNLOAD, repo.repo_id, repo.revision, json.dumps(patterns)],
                                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, env=env)
        try:
            while proc.poll() is None:
                done = min(total, sum(_repo_bytes(r) for r in spec.repos))
                report(min(0.99, done / total), f"Downloading {spec.name}: {done / 1e9:.1f} of {total / 1e9:.1f} GB",
                       bytes_done=done, bytes_total=total, current_item=repo.repo_id)
                time.sleep(poll_s)
        except BaseException:
            _stop(proc)
            raise
        err = proc.stderr.read() if proc.stderr else ""
        if proc.returncode != 0:
            if "No space left" in err or "ENOSPC" in err:
                raise OSError(errno.ENOSPC, f"The disk filled up while downloading {repo.repo_id}.")
            last = err.strip().splitlines()[-1] if err.strip() else f"exit code {proc.returncode}"
            raise VoiceError("install_failed", f"Downloading {repo.repo_id} failed: {last}",
                             "Check the network connection, then try again.", status=502)
    if not is_installed(spec):
        raise VoiceError("install_failed", f"{spec.name} downloaded but some files are missing.",
                         "Try the install again.", status=502)
    report(1.0, f"{spec.name} installed.", bytes_done=total, bytes_total=total, current_item=None)
