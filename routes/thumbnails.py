"""Bounded, persistent preview cache. Originals are never modified."""
import asyncio
import hashlib
import io
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import threading

from aiohttp import web
from PIL import Image, ImageOps, UnidentifiedImageError
from ..utils import get_config, resolve_browser_path, image_extensions, video_extensions

cache_lock = threading.Lock()
preview_slots = asyncio.Semaphore(2)
CACHE_NAME = re.compile(r'^[a-f0-9]{64}\.webp$')


def cache_dir():
    return Path(get_config()['thumbnail_cache']).expanduser().resolve()


def cache_files():
    directory = cache_dir()
    if not directory.exists():
        return []
    return [p for p in directory.iterdir() if CACHE_NAME.fullmatch(p.name) and p.is_file() and not p.is_symlink()]


def cache_status(clear=False):
    with cache_lock:
        files = cache_files()
        if clear:
            for file in files:
                file.unlink(missing_ok=True)
            files = []
        return {'files': len(files), 'bytes': sum(p.stat().st_size for p in files),
                'video_previews': shutil.which('ffmpeg') is not None}


def thumbnail(source):
    config = get_config()
    size = max(128, min(1024, int(config['thumbnail_size'])))
    stat = os.stat(source)
    key = hashlib.sha256(f'v1:{source}:{stat.st_mtime_ns}:{stat.st_ctime_ns}:{stat.st_size}:{size}'.encode()).hexdigest()
    with cache_lock:
        directory = cache_dir()
        directory.mkdir(parents=True, exist_ok=True)
        target = directory / f'{key}.webp'
        if target.exists():
            data = target.read_bytes()
            os.utime(target, None)
            return data, key
        extension = Path(source).suffix.lower()
        if extension in image_extensions:
            image_source = source
        elif extension in video_extensions:
            ffmpeg = shutil.which('ffmpeg')
            if not ffmpeg:
                raise ValueError('Install ffmpeg on the server for video thumbnails')
            result = subprocess.run([
                ffmpeg, '-nostdin', '-v', 'error', '-i', source, '-frames:v', '1',
                '-vf', f'scale={size}:{size}:force_original_aspect_ratio=decrease',
                '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1',
            ], capture_output=True, timeout=20, check=True)
            image_source = io.BytesIO(result.stdout)
        else:
            raise ValueError('No thumbnail for this file type')
        with Image.open(image_source) as original:
            preview = ImageOps.exif_transpose(original)
            preview.thumbnail((size, size), Image.Resampling.LANCZOS)
            preview = preview.convert('RGBA' if 'A' in preview.getbands() or 'transparency' in original.info else 'RGB')
            data_buffer = io.BytesIO()
            preview.save(data_buffer, format='WEBP', quality=80)
            data = data_buffer.getvalue()
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=directory, prefix='preview-', delete=False) as out:
                temporary = out.name
                out.write(data)
            os.replace(temporary, target)
        finally:
            if temporary and os.path.exists(temporary):
                os.unlink(temporary)
        # Least recently used disk entries are evicted when the configured cap is exceeded.
        files = sorted(cache_files(), key=lambda p: p.stat().st_mtime_ns)
        total = sum(p.stat().st_size for p in files)
        budget = max(16, int(config['thumbnail_cache_mb'])) * 1024 ** 2
        for file in files:
            if total <= budget:
                break
            total -= file.stat().st_size
            file.unlink(missing_ok=True)
        return data, key


async def api_thumbnail(request):
    try:
        source = resolve_browser_path(request.query.get('folder_type', 'outputs'),
                                      request.query.get('folder_path', ''),
                                      request.query.get('filename', ''))
        if not os.path.isfile(source):
            raise web.HTTPNotFound()
        async with preview_slots:
            data, key = await asyncio.to_thread(thumbnail, source)
    except ValueError as exc:
        raise web.HTTPBadRequest(text=str(exc))
    except (OSError, UnidentifiedImageError, subprocess.SubprocessError, Image.DecompressionBombError):
        raise web.HTTPUnsupportedMediaType(text='Preview unavailable; open the original file')
    headers = {'ETag': f'"{key}"', 'Cache-Control': 'private, no-cache'}
    if request.headers.get('If-None-Match') == headers['ETag']:
        return web.Response(status=304, headers=headers)
    return web.Response(body=data, content_type='image/webp', headers=headers)


async def api_cache_status(request):
    return web.json_response(await asyncio.to_thread(cache_status, request.method == 'DELETE'))
