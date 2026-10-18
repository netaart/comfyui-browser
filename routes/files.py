from aiohttp import web
import asyncio
import base64
import json
from os import path
import os
import shutil
import mimetypes

from ..utils import (
    get_target_folder_files, get_browser_root_path, get_info_filename,
    search_browser_directories, load_favorite_records,
)

_FAVORITE_REF_PREFIX = '__favorite_refs__'
_LEGACY_FAVORITE_COPIES_KEY = '__legacy_favorite_copies__'


def _favorite_parts(key):
    try:
        parts = json.loads(key)
    except (TypeError, json.JSONDecodeError):
        return None
    if not isinstance(parts, list) or len(parts) != 4:
        return None
    folder_type, root_id, folder_path, filename = parts
    if folder_type not in ('outputs', 'sources') or not filename:
        return None
    return folder_type, root_id or 'outputs', folder_path or '', filename


def _favorite_token(key):
    return base64.urlsafe_b64encode(key.encode('utf-8')).decode('ascii').rstrip('=')


def _favorite_source(key):
    parts = _favorite_parts(key)
    if not parts:
        return None
    folder_type, root_id, folder_path, filename = parts
    root_path = get_browser_root_path(root_id, folder_type)
    if not root_path:
        return None
    real_root = path.realpath(root_path)
    source_path = path.realpath(path.join(real_root, folder_path, filename))
    try:
        if path.commonpath([real_root, source_path]) != real_root or not path.exists(source_path):
            return None
    except ValueError:
        return None
    return {
        'folder_type': folder_type,
        'root_id': root_id,
        'folder_path': folder_path,
        'filename': filename,
        'root_path': real_root,
        'source_path': source_path,
    }


def _favorite_reference_files():
    records = load_favorite_records()
    legacy_names = records.get(_LEGACY_FAVORITE_COPIES_KEY, [])
    hidden_copies = set(legacy_names if isinstance(legacy_names, list) else [])
    hidden_copies.update(
        value for key, value in records.items()
        if key != _LEGACY_FAVORITE_COPIES_KEY and isinstance(value, str)
    )
    references = []
    for key in records:
        if key == _LEGACY_FAVORITE_COPIES_KEY:
            continue
        source = _favorite_source(key)
        if not source:
            continue
        try:
            source_stat = os.stat(source['source_path'])
        except OSError:
            continue
        is_dir = path.isdir(source['source_path'])
        token = _favorite_token(key)
        references.append({
            'type': 'dir' if is_dir else 'file',
            'name': source['filename'],
            'bytes': 0 if is_dir else source_stat.st_size,
            'created_at': source_stat.st_mtime,
            'folder_path': '',
            'notes': '',
            'children_count': 1 if is_dir else 0,
            'preview_items': [],
            'root_id': 'outputs',
            'path': f'{_FAVORITE_REF_PREFIX}/{token}',
            'favorite_reference': True,
            'favorite_reference_root': True,
            'favorite_key': key,
            'source_folder_type': source['folder_type'],
            'source_root_id': source['root_id'],
            'source_folder_path': source['folder_path'],
            'source_filename': source['filename'],
        })
    return references, hidden_copies


def _favorite_reference_children(folder_path):
    parts = folder_path.split('/')
    if len(parts) < 2 or parts[0] != _FAVORITE_REF_PREFIX:
        return None
    token = parts[1]
    try:
        key = base64.urlsafe_b64decode(token + '=' * (-len(token) % 4)).decode('utf-8')
    except (ValueError, UnicodeDecodeError):
        return []
    if key not in load_favorite_records():
        return []
    source = _favorite_source(key)
    if not source or not path.isdir(source['source_path']):
        return []
    relative_path = path.join(source['folder_path'], source['filename'], *parts[2:])
    target_path = path.realpath(path.join(source['root_path'], relative_path))
    try:
        if path.commonpath([source['root_path'], target_path]) != source['root_path'] or not path.isdir(target_path):
            return []
    except ValueError:
        return []
    items = get_target_folder_files(
        relative_path,
        folder_type=source['folder_type'],
        root_id=source['root_id'],
        show_hidden=True,
        fast_directory_stats=True,
    )
    for item in items or []:
        source_folder_path = item.get('folder_path', '')
        item.update({
            'favorite_reference': True,
            'favorite_reference_root': False,
            'favorite_key': key,
            'source_folder_type': source['folder_type'],
            'source_root_id': source['root_id'],
            'source_folder_path': source_folder_path,
            'source_filename': item['name'],
            'folder_path': folder_path,
        })
        if item.get('type') == 'dir':
            item['path'] = f'{folder_path}/{item["name"]}'
        item['preview_items'] = [
            {
                **preview,
                'favorite_reference': True,
                'source_folder_type': source['folder_type'],
                'source_root_id': source['root_id'],
                # Directory previews belong to the directory being previewed,
                # which is one level below this directory entry.
                'source_folder_path': path.join(source_folder_path, item['name']) if item.get('type') == 'dir' else source_folder_path,
            }
            for preview in item.get('preview_items', [])
        ]
    return items or []


def _get_collection_files(folder_path, show_hidden=False):
    if folder_path.startswith(_FAVORITE_REF_PREFIX + '/'):
        return _favorite_reference_children(folder_path) or []
    files = get_target_folder_files(folder_path, folder_type='collections', show_hidden=show_hidden) or []
    if folder_path:
        return files
    references, hidden_copies = _favorite_reference_files()
    files = [item for item in files if item.get('name') not in hidden_copies]
    return files + references

# folder_path, folder_type
async def api_get_files(request):
    folder_path = request.query.get('folder_path', '')
    folder_type = request.query.get('folder_type', 'outputs')
    root_id = request.query.get('root_id', 'outputs')
    path_search = request.query.get('path_search', '').strip()
    show_hidden = request.query.get('show_hidden', '').lower() in ('1', 'true', 'yes')
    if folder_type == 'collections':
        files = await asyncio.to_thread(_get_collection_files, folder_path, show_hidden)
        return web.json_response({'files': files})
    if path_search:
        if folder_type != 'outputs':
            return web.json_response({'files': []})
        files = await asyncio.to_thread(search_browser_directories, path_search, root_id, folder_path, show_hidden=show_hidden)
        return web.json_response({'files': files})
    files = await asyncio.to_thread(
        get_target_folder_files,
        folder_path,
        folder_type=folder_type,
        root_id=root_id,
        show_hidden=show_hidden,
    )

    if files == None:
        return web.Response(status=404)

    return web.json_response({
        'files': files
    })


# filename, folder_path, folder_type
async def api_delete_file(request):
    json_data = await request.json()
    filename = json_data['filename']
    folder_path = json_data.get('folder_path', '')
    folder_type = json_data.get('folder_type', 'outputs')
    root_id = json_data.get('root_id')

    parent_path = get_browser_root_path(root_id, folder_type)
    if parent_path is None:
        return web.Response(status=404)
    target_path = path.join(parent_path, folder_path, filename)
    if not path.exists(target_path):
        return web.json_response(status=404)

    if path.isdir(target_path):
        shutil.rmtree(target_path)
    else:
        os.remove(target_path)
    info_file_path = get_info_filename(target_path)
    if path.exists(info_file_path):
        os.remove(info_file_path)

    return web.Response(status=201)


# filename, folder_path, folder_type, new_data: {}
async def api_update_file(request):
    json_data = await request.json()
    filename = json_data['filename']
    folder_path = json_data.get('folder_path', '')
    folder_type = json_data.get('folder_type', 'outputs')
    root_id = json_data.get('root_id')
    parent_path = get_browser_root_path(root_id, folder_type)
    if parent_path is None:
        return web.Response(status=404)

    new_data = json_data.get('new_data', None)
    if not new_data:
        return web.Response(status=400)

    new_filename = new_data['filename']
    notes = new_data['notes']

    old_file_path = path.join(parent_path, folder_path, filename)
    new_file_path = path.join(parent_path, folder_path, new_filename)

    if not path.exists(old_file_path):
        return web.Response(status=404)

    if new_filename and filename != new_filename:
        shutil.move(
            old_file_path,
            new_file_path
        )
        old_info_file_path = get_info_filename(old_file_path)
        if path.exists(old_info_file_path):
            new_info_file_path = get_info_filename(new_file_path)
            shutil.move(
                old_info_file_path,
                new_info_file_path
            )

    if notes:
        extra = {
            "notes": notes
        }
        info_file_path = get_info_filename(new_file_path)
        with open(info_file_path, "w", encoding="utf-8") as outfile:
            json.dump(extra, outfile)

    return web.Response(status=201)

# filename, folder_path, folder_type
async def api_view_file(request):
    folder_type = request.query.get("folder_type", "outputs")
    folder_path = request.query.get("folder_path", "")
    root_id = request.query.get("root_id")
    filename = request.query.get("filename", None)
    if not filename:
        return web.Response(status=404)

    parent_path = get_browser_root_path(root_id, folder_type)
    if parent_path is None:
        return web.Response(status=404)
    file_path = path.join(parent_path, folder_path, filename)

    if not path.exists(file_path):
        return web.Response(status=404)

    content_type, _ = mimetypes.guess_type(file_path)
    response = web.FileResponse(file_path)
    if content_type:
        response.content_type = content_type
    return response
