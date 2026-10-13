"""Native browser downloads backed by temporary files, not whole-archive RAM buffers."""
import asyncio
import json
import os
import tarfile
import tempfile
import zipfile

from aiohttp import web
from ..utils import resolve_browser_path, image_extensions, video_extensions, white_extensions
from .files import disposition

archive_slots = asyncio.Semaphore(1)
MAX_FILES = 5000
MAX_BYTES = 20 * 1024 ** 3


def archive_entries(payload):
    if not isinstance(payload, dict):
        raise ValueError('Expected an archive request')
    names = payload.get('files')
    folder_type = payload.get('folder_type', 'outputs')
    folder_path = payload.get('folder_path', '')
    if not isinstance(names, list) or not 1 <= len(names) <= MAX_FILES:
        raise ValueError(f'Select between 1 and {MAX_FILES} files')
    entries = {}
    for name in names:
        if not isinstance(name, str) or '/' in name or '\\' in name or name.startswith('.'):
            raise ValueError('Select files from one folder')
        source = resolve_browser_path(folder_type, folder_path, name)
        if not os.path.isfile(source) or os.path.splitext(name)[1].lower() not in white_extensions:
            raise ValueError(f'File unavailable: {name}')
        entries[name] = source
        if payload.get('include_workflows', True) and os.path.splitext(name)[1].lower() in image_extensions + video_extensions:
            sidecar = os.path.splitext(name)[0] + '.json'
            candidate = resolve_browser_path(folder_type, folder_path, sidecar)
            if os.path.isfile(candidate):
                entries[sidecar] = candidate
    if len(entries) > MAX_FILES or sum(os.path.getsize(p) for p in entries.values()) > MAX_BYTES:
        raise ValueError('Batch exceeds 5,000 files or 20 GiB; select a smaller batch')
    return entries


def build_archive(output, payload):
    entries = archive_entries(payload)
    archive_format = payload.get('format', 'zip')
    if archive_format == 'zip':
        with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
            for name, source in entries.items():
                archive.write(source, arcname=name)
    elif archive_format == 'tar.gz':
        with tarfile.open(fileobj=output, mode='w:gz', compresslevel=1) as archive:
            for name, source in entries.items():
                # Add regular file content only; never directory trees or links.
                with open(source, 'rb') as stream:
                    info = archive.gettarinfo(fileobj=stream, arcname=name)
                    if not info.isfile():
                        raise ValueError(f'Not a regular file: {name}')
                    archive.addfile(info, stream)
    else:
        raise ValueError('Choose zip or tar.gz')
    output.seek(0)


async def api_download_archive(request):
    try:
        if request.content_type == 'application/json':
            payload = await request.json()
        else:
            form = await request.post()
            payload = json.loads(form.get('payload', '{}'))
        if not isinstance(payload, dict) or payload.get('format', 'zip') not in ('zip', 'tar.gz'):
            raise ValueError('Choose zip or tar.gz')
    except (ValueError, TypeError):
        raise web.HTTPBadRequest(text='Invalid archive request')

    async with archive_slots:
        with tempfile.TemporaryFile() as output:
            # Shield the disk worker so cancellation cannot close its file mid-write.
            worker = asyncio.create_task(asyncio.to_thread(build_archive, output, payload))
            try:
                await asyncio.shield(worker)
                archive_format = payload.get('format', 'zip')
                response = web.StreamResponse(headers={
                    'Content-Type': 'application/zip' if archive_format == 'zip' else 'application/gzip',
                    'Content-Disposition': disposition(f'comfyui-files.{archive_format}', True),
                    'Content-Length': str(os.fstat(output.fileno()).st_size),
                    'Cache-Control': 'no-store',
                })
                await response.prepare(request)
                while chunk := await asyncio.to_thread(output.read, 256 * 1024):
                    await response.write(chunk)
                await response.write_eof()
                return response
            except (ValueError, FileNotFoundError) as exc:
                raise web.HTTPBadRequest(text=str(exc))
            except PermissionError:
                raise web.HTTPForbidden(text='Cannot read one of the selected files')
            finally:
                if not worker.done():
                    await asyncio.gather(worker, return_exceptions=True)
