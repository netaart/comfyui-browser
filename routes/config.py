from aiohttp import web
import json
import os

from ..utils import get_config, git_remote_name, run_cmd, git_init, \
    collections_path, config_path, get_browser_roots, save_browser_roots

async def api_get_browser_config(_):
    config = get_config()

    return web.json_response(config)

async def api_get_browser_roots(_):
    return web.json_response({"roots": get_browser_roots()})

async def api_browse_browser_directories(request):
    requested = request.query.get("path")
    directory = os.path.realpath(os.path.expanduser(requested)) if requested else os.path.expanduser("~")
    if not os.path.isdir(directory):
        return web.json_response({"message": "Directory does not exist."}, status=400)
    try:
        entries = []
        with os.scandir(directory) as listing:
            for entry in listing:
                if entry.name.startswith("."):
                    continue
                try:
                    if entry.is_dir():
                        entries.append({"name": entry.name, "path": entry.path})
                except OSError:
                    continue
        entries.sort(key=lambda item: item["name"].casefold())
    except OSError as error:
        return web.json_response({"message": str(error)}, status=403)
    parent = os.path.dirname(directory) if os.path.dirname(directory) != directory else None
    return web.json_response({"path": directory, "parent": parent, "directories": entries})

async def api_add_browser_root(request):
    data = await request.json()
    raw_path = (data.get("path") or "").strip()
    if not raw_path:
        return web.json_response({"message": "Enter a directory path."}, status=400)
    root_path = os.path.realpath(os.path.expanduser(raw_path))
    if not os.path.isdir(root_path):
        return web.json_response({"message": "Directory does not exist."}, status=400)

    roots = [root for root in get_browser_roots() if not root["default"]]
    existing = next((root for root in roots if root["path"] == root_path), None)
    if existing:
        return web.json_response({"root": existing}, status=200)
    name = (data.get("name") or os.path.basename(root_path) or root_path).strip()
    roots.append({"name": name, "path": root_path})
    save_browser_roots(roots)
    added = next(root for root in get_browser_roots() if root["path"] == root_path)
    return web.json_response({"root": added}, status=201)

async def api_reorder_browser_roots(request):
    data = await request.json()
    root_ids = data.get("root_ids")
    if not isinstance(root_ids, list) or not all(isinstance(root_id, str) for root_id in root_ids):
        return web.json_response({"message": "A list of directory IDs is required."}, status=400)

    roots = [root for root in get_browser_roots() if not root["default"]]
    roots_by_id = {root["id"]: root for root in roots}
    if len(root_ids) != len(roots) or set(root_ids) != set(roots_by_id):
        return web.json_response({"message": "The directory list has changed. Refresh and try again."}, status=409)

    save_browser_roots([roots_by_id[root_id] for root_id in root_ids])
    return web.json_response({"roots": get_browser_roots()})

async def api_delete_browser_root(request):
    root_id = request.match_info.get("root_id")
    roots = [root for root in get_browser_roots() if not root["default"]]
    if not any(root["id"] == root_id for root in roots):
        return web.Response(status=404)
    save_browser_roots([root for root in roots if root["id"] != root_id])
    return web.Response(status=200)

# git_repo
async def api_update_browser_config(request):
    json_data = await request.json()
    config = get_config()
    git_repo = json_data.get('git_repo', config.get('git_repo'))

    git_init()

    if git_repo == '':
        ret = run_cmd(f'git remote remove {git_remote_name}', collections_path())
        if not ret.returncode == 0:
            return web.json_response(
                { 'message': ret.stderr },
                status=500,
            )

        set_config({ 'git_repo': git_repo })
        return web.Response(status=200)

    ret = git_set_remote_url(git_repo)
    if not ret.returncode == 0:
        return web.json_response(
            { 'message': ret.stderr },
            status=500,
        )

    set_config({ 'git_repo': git_repo })
    return web.Response(status=200)

def set_config(config):
    with open(config_path, 'w', encoding='utf-8') as f:
        json.dump(config, f)

def git_set_remote_url(remote_url, run_path = collections_path()):
    ret = run_cmd('git remote', run_path)

    if git_remote_name in ret.stdout.split('\n'):
        return run_cmd(f'git remote set-url {git_remote_name} {remote_url}', run_path)
    else:
        return run_cmd(f'git remote add {git_remote_name} {remote_url}', run_path)
