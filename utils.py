import functools
import hashlib
import json
from os import path, scandir, makedirs, walk, stat
from os.path import expanduser, realpath
import subprocess
import time
from typing import TypedDict, List
import requests
from requests.adapters import HTTPAdapter, Retry

import folder_paths
from comfy.cli_args import args

SERVER_BASE_URL = f'http://{args.listen}:{args.port}'
# To support IPv6
if ':' in args.listen:
    SERVER_BASE_URL = f'http://[{args.listen}]:{args.port}'

browser_path = path.dirname(__file__)
config_path = path.join(browser_path, 'config.json')

image_extensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg']
video_extensions = ['.mp4', '.mov', '.avi', '.webm', '.mkv']
audio_extensions = ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac']
text_extensions = ['.txt', '.md', '.csv', '.log']
white_extensions = ['.json', '.html'] + image_extensions + video_extensions + audio_extensions + text_extensions

info_file_suffix = '.info'

git_remote_name = 'origin'

def http_client():
    adapter = HTTPAdapter(max_retries=Retry(3, backoff_factor=0.1))
    http = requests.session()
    http.mount('http://', adapter)
    http.mount('https://', adapter)

    return http


@functools.cache
def get_config():
    return {
        "collections": path.join(browser_path, 'collections'),
        "download_logs": path.join(browser_path, 'download_logs'),
        "outputs": output_directory_from_comfyui(),
        "sources": path.join(browser_path, 'sources'),
    } | load_config()

def load_config():
    if not path.exists(config_path):
        return {}
    else:
        with open(config_path, 'r') as f:
            return json.load(f)

@functools.cache
def collections_path():
    return get_config()['collections']

@functools.cache
def download_logs_path():
    return get_config()['download_logs']

@functools.cache
def outputs_path():
    return get_config()['outputs']

@functools.cache
def sources_path():
    return get_config()['sources']


class FileInfoDict(TypedDict):
    type: str
    name: str
    bytes: int
    created_at: float
    folder_path: str
    notes: str

def log(message):
    print('[comfyui-browser] ' + message)

def run_cmd(cmd, run_path, log_cmd=True, log_code=True, log_message=True):
    if log_cmd:
        log(f'running: {cmd}')

    ret = subprocess.run(
        f'cd {run_path} && {cmd}',
        shell=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        encoding="UTF-8"
    )
    if log_code:
        if ret.returncode == 0:
            log('successed')
        else:
            log('failed')
    if log_message:
        if (len(ret.stdout) > 0 or len(ret.stderr) > 0):
            log(ret.stdout + ret.stderr)

    return ret

# folder_type = 'outputs', 'collections', 'sources'
def get_parent_path(folder_type: str):
    if folder_type == 'collections':
        return collections_path()
    if folder_type == 'sources':
        return sources_path()

    # outputs
    return outputs_path()

def get_browser_roots():
    roots = [{
        "id": "outputs",
        "name": "Output",
        "path": outputs_path(),
        "default": True,
    }]
    custom_roots = load_config().get("browser_roots", [])
    if not isinstance(custom_roots, list):
        custom_roots = []
    for root in custom_roots:
        if not isinstance(root, dict):
            continue
        raw_path = root.get("path", "")
        if not raw_path:
            continue
        root_path = realpath(expanduser(raw_path))
        root_id = "custom-" + hashlib.sha1(root_path.encode("utf-8")).hexdigest()[:12]
        roots.append({
            "id": root_id,
            "name": root.get("name") or path.basename(root_path) or root_path,
            "path": root_path,
            "default": False,
        })
    return roots

def save_browser_roots(roots):
    config = load_config()
    config["browser_roots"] = [
        {"name": root["name"], "path": root["path"]}
        for root in roots
        if root.get("name") and root.get("path")
    ]
    with open(config_path, 'w', encoding='utf-8') as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    get_config.cache_clear()
    collections_path.cache_clear()
    download_logs_path.cache_clear()
    outputs_path.cache_clear()
    sources_path.cache_clear()

def get_browser_root_path(root_id: str | None = None, folder_type: str = 'outputs'):
    if not root_id or root_id == 'outputs':
        return get_parent_path(folder_type)
    if folder_type != 'outputs':
        return None
    return next((root["path"] for root in get_browser_roots() if root["id"] == root_id), None)

# folder_type = 'outputs', 'collections', 'sources'
def get_target_folder_files(
    folder_path: str,
    folder_type: str = 'outputs',
    root_id: str | None = None,
    show_hidden: bool = False,
    fast_directory_stats: bool = False,
):
    if '..' in folder_path:
        return None

    parent_path = get_browser_root_path(root_id, folder_type)
    if parent_path is None:
        return None
    files: List[FileInfoDict] = []
    target_path = path.join(parent_path, folder_path)

    if not path.exists(target_path):
        return []

    folder_listing = scandir(target_path)
    favorite_records = load_favorite_records() if folder_type != 'collections' else {}
    folder_listing = sorted(folder_listing, key=lambda f: (f.is_file(), -f.stat().st_ctime))
    for item in folder_listing:
        if not path.exists(item.path):
            continue

        name = path.basename(item.path)
        ext = path.splitext(name)[1].lower()
        if name == '' or (name[0] == '.' and (item.is_file() or not show_hidden)):
            continue
        if item.is_file():
            if not (ext in white_extensions):
                continue

        created_at = item.stat().st_ctime
        info_file_path = get_info_filename(item.path)
        info_data = {}
        if path.exists(info_file_path):
            with open(info_file_path, 'r') as f:
                info_data = json.load(f)
        if item.is_file():
            bytes = item.stat().st_size
            file_info = {
                "type": "file",
                "name": name,
                "bytes": bytes,
                "created_at": created_at,
                "folder_path": folder_path,
                "notes": info_data.get("notes", "")
            }
            file_info["is_favorite"] = favorite_key(folder_type, folder_path, name, root_id) in favorite_records
            file_info["root_id"] = root_id or 'outputs'
            files.append(file_info)
        elif item.is_dir():
            child_count, folder_bytes = (1, 0) if fast_directory_stats else get_directory_stats(item.path)
            try:
                direct_files = sorted(
                    (child for child in scandir(item.path)
                     if child.is_file() and not child.name.startswith('.')
                     and path.splitext(child.name)[1].lower() in white_extensions),
                    key=lambda child: child.name.lower(),
                )
                media_stems = {
                    path.splitext(child.name)[0]
                    for child in direct_files
                    if path.splitext(child.name)[1].lower() in image_extensions + video_extensions
                }
                direct_files = [
                    child for child in direct_files
                    if not (
                        path.splitext(child.name)[1].lower() == '.json'
                        and path.splitext(child.name)[0] in media_stems
                    )
                ]
                image_files = [child for child in direct_files if path.splitext(child.name)[1].lower() in image_extensions]
                other_files = [child for child in direct_files if child not in image_files]
                if image_files and other_files:
                    preview_files = image_files[:2] + other_files[:1]
                else:
                    preview_files = (image_files or other_files)[:3]
                preview_items = []
                for child in preview_files:
                    child_ext = path.splitext(child.name)[1].lower()
                    if child_ext in image_extensions:
                        file_type = 'image'
                    elif child_ext in video_extensions:
                        file_type = 'video'
                    elif child_ext in audio_extensions:
                        file_type = 'audio'
                    elif child_ext in ['.html', '.json']:
                        file_type = child_ext[1:]
                    else:
                        file_type = 'text'
                    preview_items.append({"name": child.name, "fileType": file_type})
            except OSError:
                preview_items = []
            files.append({
                "type": "dir",
                "name": name,
                "bytes": folder_bytes,
                "children_count": child_count,
                "preview_items": preview_items,
                "is_favorite": favorite_key(folder_type, folder_path, name, root_id) in favorite_records,
                "root_id": root_id or 'outputs',
                "created_at": created_at,
                "folder_path": folder_path,
                "notes": info_data.get("notes", "")
            })

    return files

def search_browser_directories(
    query: str,
    root_id: str | None = None,
    base_folder_path: str = '',
    limit: int = 200,
    show_hidden: bool = False,
):
    root_path = get_browser_root_path(root_id, 'outputs')
    if not root_path or not path.isdir(root_path):
        return []
    root_path = realpath(root_path)
    search_root = realpath(path.join(root_path, base_folder_path))
    if path.commonpath([root_path, search_root]) != root_path:
        return []
    if not path.isdir(search_root):
        return []
    needle = query.strip().replace('\\', '/').strip('/').casefold()
    if not needle:
        return []

    matches = []
    favorite_records = load_favorite_records()
    for current_path, directory_names, filenames in walk(search_root, followlinks=False):
        current_relative_path = path.relpath(current_path, search_root).replace('\\', '/')
        # Owner: Sean — hidden folders are opt-in in directory search.
        directory_names[:] = [
            name for name in directory_names
            if show_hidden or not name.startswith('.')
            or needle.startswith(
                (name if current_relative_path == '.' else f'{current_relative_path}/{name}').casefold() + '/'
            )
            or needle == (name if current_relative_path == '.' else f'{current_relative_path}/{name}').casefold()
        ]
        matched_directory_names = []
        for name in directory_names:
            full_path = path.join(current_path, name)
            relative_path = path.relpath(full_path, root_path).replace('\\', '/')
            if needle not in relative_path.casefold():
                continue
            try:
                folder_stat = stat(full_path)
            except OSError:
                continue
            parent_path = path.relpath(current_path, root_path)
            folder_path = '' if parent_path == '.' else parent_path.replace('\\', '/')
            matches.append({
                "type": "dir",
                "name": name,
                "path": relative_path,
                "bytes": 0,
                "created_at": folder_stat.st_ctime,
                "folder_path": folder_path,
                "notes": "",
                "children_count": 1,
                "preview_items": [],
                "root_id": root_id or 'outputs',
            })
            matched_directory_names.append(name)
            if len(matches) >= limit:
                return matches
        # Owner: Sean — path search includes supported files as well as folders.
        for name in filenames:
            if name.startswith('.'):
                continue
            if path.splitext(name)[1].lower() not in white_extensions:
                continue
            full_path = path.join(current_path, name)
            relative_path = path.relpath(full_path, root_path).replace('\\', '/')
            if needle not in relative_path.casefold():
                continue
            try:
                file_stat = stat(full_path)
            except OSError:
                continue
            parent_path = path.relpath(current_path, root_path)
            folder_path = '' if parent_path == '.' else parent_path.replace('\\', '/')
            matches.append({
                "type": "file",
                "name": name,
                "bytes": file_stat.st_size,
                "created_at": file_stat.st_ctime,
                "folder_path": folder_path,
                "notes": "",
                "is_favorite": favorite_key('outputs', folder_path, name, root_id) in favorite_records,
                "root_id": root_id or 'outputs',
            })
            if len(matches) >= limit:
                return matches
        if matched_directory_names:
            directory_names[:] = [name for name in directory_names if name not in matched_directory_names]
    return matches

def favorites_manifest_path():
    return path.join(collections_path(), '.browser-favorites.json')

def favorite_key(folder_type: str, folder_path: str, filename: str, root_id: str | None = None) -> str:
    return json.dumps([folder_type, root_id or 'outputs', folder_path or '', filename], ensure_ascii=False)

def load_favorite_records() -> dict:
    manifest = favorites_manifest_path()
    if not path.exists(manifest):
        return {}
    try:
        with open(manifest, 'r', encoding='utf-8') as f:
            records = json.load(f)
        return records if isinstance(records, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}

def save_favorite_records(records: dict):
    with open(favorites_manifest_path(), 'w', encoding='utf-8') as f:
        json.dump(records, f, ensure_ascii=False, indent=2)

def get_directory_stats(folder_path: str) -> tuple[int, int]:
    visible_file_count = 0
    total = 0
    for root, _, filenames in walk(folder_path, followlinks=False):
        relative_root = path.relpath(root, folder_path)
        visible_root = relative_root == '.' or not any(
            part.startswith('.') for part in relative_root.split(path.sep)
        )
        media_stems = {
            path.splitext(filename)[0]
            for filename in filenames
            if not filename.startswith('.')
            and path.splitext(filename)[1].lower() in image_extensions + video_extensions
        }
        for filename in filenames:
            file_path = path.join(root, filename)
            try:
                total += path.getsize(file_path)
            except OSError:
                continue

            if not visible_root or filename.startswith('.'):
                continue
            extension = path.splitext(filename)[1].lower()
            if extension not in white_extensions:
                continue
            if extension == '.json' and path.splitext(filename)[0] in media_stems:
                continue
            visible_file_count += 1

    return visible_file_count, total

def get_info_filename(filename):
    return path.splitext(filename)[0] + info_file_suffix

def add_uuid_to_filename(filename):
    name, ext = path.splitext(filename)
    return f'{name}_{int(time.time())}{ext}'

def output_directory_from_comfyui():
   if args.output_directory:
       return path.abspath(args.output_directory)
   else:
       return folder_paths.get_output_directory()

def git_init():
    if not path.exists(path.join(collections_path(), '.git')):
        run_cmd('git init', collections_path())

    ret = run_cmd('git config user.name', collections_path(),
                  log_cmd=False, log_code=False, log_message=False)
    if len(ret.stdout) == 0:
        ret = run_cmd('whoami', collections_path(),
                      log_cmd=False, log_code=False, log_message=False)
        username = ret.stdout.rstrip("\n")
        run_cmd(f'git config user.name "{username}"', collections_path())

    ret = run_cmd('git config user.email', collections_path(),
                  log_cmd=False, log_code=False, log_message=False)
    if len(ret.stdout) == 0:
        ret = run_cmd('hostname', collections_path(),
                      log_cmd=False, log_code=False, log_message=False)
        hostname = ret.stdout.rstrip("\n")
        run_cmd(f'git config user.email "{hostname}"', collections_path())

for dir in [
    collections_path(),
    sources_path(),
    download_logs_path(),
    outputs_path(),
]:
    makedirs(dir, exist_ok=True)
