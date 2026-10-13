import functools
import json
from os import path, scandir, makedirs
import subprocess
import time
import re
import ntpath
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

image_extensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp']
video_extensions = ['.mp4', '.mov', '.avi', '.webm', '.mkv']
white_extensions = ['.json', '.html'] + image_extensions + video_extensions

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
        "thumbnail_cache": path.join(browser_path, '.cache', 'thumbnails'),
        "thumbnail_cache_mb": 512,
        "thumbnail_size": 384,
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
    modified_at: float
    mtime_ns: str
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

    if folder_type == 'outputs':
        return outputs_path()
    raise ValueError('Unknown folder type')


def resolve_browser_path(folder_type='outputs', folder_path='', filename=''):
    """Resolve only paths contained in the selected browser root, including symlinks."""
    root = path.realpath(get_parent_path(folder_type))
    for value in (folder_path, filename):
        if not isinstance(value, str) or '\x00' in value:
            raise ValueError('Invalid path')
        if ntpath.isabs(value) or ntpath.splitdrive(value)[0] or '\\' in value:
            raise ValueError('Paths must be relative to the browser root')
        if '..' in value.split('/'):
            raise ValueError('Path is outside the browser root')
    target = path.abspath(path.join(root, folder_path, filename))
    if path.commonpath([root, path.realpath(target)]) != root:
        raise ValueError('Path is outside the browser root')
    return target


def natural_name(value):
    return tuple((1, int(part)) if part.isdigit() else (0, part.casefold())
                 for part in re.split(r'(\d+)', value))


def sort_files(files, sort_by='name', order='asc'):
    keys = {
        'name': lambda f: natural_name(f['name']),
        'mtime': lambda f: f.get('modified_at', 0),
        'size': lambda f: f.get('bytes', 0),
        'type': lambda f: path.splitext(f['name'])[1].casefold(),
    }
    if sort_by not in keys or order not in ('asc', 'desc'):
        raise ValueError('Invalid sort field or direction')
    # Stable secondary name order, with directories first in either direction.
    files = sorted(files, key=lambda f: natural_name(f['name']))
    files.sort(key=keys[sort_by], reverse=order == 'desc')
    files.sort(key=lambda f: f['type'] != 'dir')
    return files

# folder_type = 'outputs', 'collections', 'sources'
def get_target_folder_files(folder_path: str, folder_type: str = 'outputs'):
    files: List[FileInfoDict] = []
    target_path = resolve_browser_path(folder_type, folder_path)

    if not path.exists(target_path):
        return []

    with scandir(target_path) as listing:
        folder_listing = list(listing)
    for item in folder_listing:
        try:
            resolve_browser_path(folder_type, folder_path, item.name)
            stat = item.stat()
        except (OSError, ValueError):
            continue

        name = path.basename(item.path)
        ext = path.splitext(name)[1].lower()
        if name == '' or name[0] == '.':
            continue
        if item.is_file():
            if not (ext in white_extensions):
                continue

        created_at = stat.st_ctime  # Legacy field; ctime is not birth time on Unix.
        info_file_path = get_info_filename(item.path)
        info_data = {}
        if path.exists(info_file_path):
            try:
                safe_info = resolve_browser_path(folder_type, folder_path, path.basename(info_file_path))
                with open(safe_info, 'r') as f:
                    info_data = json.load(f)
                if not isinstance(info_data, dict):
                    info_data = {}
            except (OSError, ValueError):
                info_data = {}
        if item.is_file():
            bytes = item.stat().st_size
            files.append({
                "type": "file",
                "name": name,
                "bytes": bytes,
                "created_at": created_at,
                "modified_at": stat.st_mtime,
                "mtime_ns": str(stat.st_mtime_ns),
                "folder_path": folder_path,
                "notes": info_data.get("notes", "")
            })
        elif item.is_dir():
            files.append({
                "type": "dir",
                "name": name,
                "bytes": 0,
                "created_at": created_at,
                "modified_at": stat.st_mtime,
                "mtime_ns": str(stat.st_mtime_ns),
                "folder_path": folder_path,
                "notes": info_data.get("notes", "")
            })

    return files

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
