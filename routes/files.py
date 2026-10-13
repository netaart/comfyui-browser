from aiohttp import web
import json
from os import path
import os
import shutil
import asyncio
from urllib.parse import quote

from ..utils import get_target_folder_files, get_parent_path, get_info_filename, \
    resolve_browser_path, sort_files

# folder_path, folder_type
async def api_get_files(request):
    folder_path = request.query.get('folder_path', '')
    folder_type = request.query.get('folder_type', 'outputs')

    try:
        entries = await asyncio.to_thread(get_target_folder_files, folder_path, folder_type)
        entries = sort_files(entries, request.query.get('sort_by', 'name'),
                             request.query.get('order', 'asc'))
    except ValueError as exc:
        raise web.HTTPBadRequest(text=str(exc))
    except (FileNotFoundError, NotADirectoryError):
        raise web.HTTPNotFound(text='Folder not found')
    except PermissionError:
        raise web.HTTPForbidden(text='Cannot read this folder')
    return web.json_response({'files': entries}, headers={'Cache-Control': 'no-store'})


def safe_path(folder_type, folder_path='', filename=''):
    try:
        return resolve_browser_path(folder_type, folder_path, filename)
    except ValueError as exc:
        raise web.HTTPBadRequest(text=str(exc))


def require_filename(filename):
    if not isinstance(filename, str) or filename in ('', '.', '..') or '/' in filename or '\\' in filename:
        raise web.HTTPBadRequest(text='A single filename is required')


def disposition(filename, attachment=False):
    mode = 'attachment' if attachment else 'inline'
    return f"{mode}; filename*=UTF-8''{quote(filename, safe='')}"


# filename, folder_path, folder_type
async def api_delete_file(request):
    json_data = await request.json()
    filename = json_data.get('filename')
    require_filename(filename)
    folder_path = json_data.get('folder_path', '')
    folder_type = json_data.get('folder_type', 'outputs')

    target_path = safe_path(folder_type, folder_path, filename)
    if not path.islink(target_path) and path.realpath(target_path) == path.realpath(get_parent_path(folder_type)):
        raise web.HTTPBadRequest(text="Cannot delete the browser root")
    if not path.exists(target_path):
        return web.Response(status=404)

    info_file_path = safe_path(folder_type, folder_path, path.basename(get_info_filename(target_path)))
    if path.isdir(target_path) and not path.islink(target_path):
        shutil.rmtree(target_path)
    else:
        os.remove(target_path)
    if path.exists(info_file_path):
        os.remove(info_file_path)

    return web.Response(status=201)


# filename, folder_path, folder_type, new_data: {}
async def api_update_file(request):
    json_data = await request.json()
    filename = json_data.get('filename')
    require_filename(filename)
    folder_path = json_data.get('folder_path', '')
    folder_type = json_data.get('folder_type', 'outputs')

    new_data = json_data.get('new_data', None)
    if not new_data:
        return web.Response(status=400)

    new_filename = new_data['filename']
    require_filename(new_filename)
    notes = new_data['notes']

    old_file_path = safe_path(folder_type, folder_path, filename)
    new_file_path = safe_path(folder_type, folder_path, new_filename)
    if filename != new_filename and path.exists(new_file_path):
        raise web.HTTPConflict(text="A file with that name already exists")

    if not path.exists(old_file_path):
        return web.Response(status=404)

    if new_filename and filename != new_filename:
        shutil.move(
            old_file_path,
            new_file_path
        )
        old_info_file_path = safe_path(folder_type, folder_path, path.basename(get_info_filename(old_file_path)))
        if path.exists(old_info_file_path):
            new_info_file_path = safe_path(folder_type, folder_path, path.basename(get_info_filename(new_file_path)))
            shutil.move(
                old_info_file_path,
                new_info_file_path
            )

    if notes:
        extra = {
            "notes": notes
        }
        info_file_path = safe_path(folder_type, folder_path, path.basename(get_info_filename(new_file_path)))
        with open(info_file_path, "w", encoding="utf-8") as outfile:
            json.dump(extra, outfile)

    return web.Response(status=201)


# filename, folder_path, folder_type
async def api_view_file(request):
    folder_type = request.query.get("folder_type", "outputs")
    folder_path = request.query.get("folder_path", "")
    filename = request.query.get("filename", None)
    if not filename:
        return web.Response(status=404)

    file_path = safe_path(folder_type, folder_path, filename)
    if not path.isfile(file_path):
        raise web.HTTPNotFound(text='File not found')
    return web.FileResponse(file_path, headers={
        'Content-Disposition': disposition(filename, request.query.get('download') == '1'),
        'Cache-Control': 'no-cache',
    })


async def api_static_output(request):
    file_path = safe_path('outputs', request.match_info['relative_path'])
    if not path.isfile(file_path):
        raise web.HTTPNotFound(text='File not found')
    return web.FileResponse(file_path, headers={'Cache-Control': 'no-cache'})
