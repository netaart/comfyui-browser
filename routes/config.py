from aiohttp import web
import json
import os
import tempfile
import shlex

from ..utils import get_config, git_remote_name, run_cmd, git_init, \
    collections_path, config_path, load_config, outputs_path, sources_path, download_logs_path

async def api_get_browser_config(_):
    config = get_config()

    return web.json_response(config)

# git_repo
async def api_update_browser_config(request):
    json_data = await request.json()
    config = get_config()
    if not isinstance(json_data, dict):
        raise web.HTTPBadRequest(text='Expected settings object')
    updates = {}
    if 'outputs' in json_data:
        value = json_data['outputs']
        if not isinstance(value, str) or not value.strip():
            raise web.HTTPBadRequest(text='Enter an absolute server directory')
        value = os.path.expanduser(value.strip())
        if not os.path.isabs(value) or not os.path.isdir(value):
            raise web.HTTPBadRequest(text='Root must be an existing absolute directory on the server')
        try:
            with os.scandir(value):
                pass
        except OSError:
            raise web.HTTPBadRequest(text='The server cannot read this directory')
        updates['outputs'] = os.path.realpath(value)
    for key, minimum, maximum in [('thumbnail_size', 128, 1024), ('thumbnail_cache_mb', 16, 16384)]:
        if key in json_data:
            value = json_data[key]
            if type(value) is not int or not minimum <= value <= maximum:
                raise web.HTTPBadRequest(text=f'{key} must be between {minimum} and {maximum}')
            updates[key] = value
    if 'git_repo' not in json_data:
        if not updates:
            raise web.HTTPBadRequest(text='No supported settings supplied')
        set_config(updates)
        return web.json_response(get_config())
    git_repo = json_data.get('git_repo', config.get('git_repo'))
    if not isinstance(git_repo, str):
        raise web.HTTPBadRequest(text='Invalid Git repository')

    git_init()

    if git_repo == '':
        remotes = run_cmd('git remote', collections_path())
        if git_remote_name not in remotes.stdout.split():
            set_config(updates | {'git_repo': ''})
            return web.Response(status=200)
        ret = run_cmd(f'git remote remove {git_remote_name}', collections_path())
        if not ret.returncode == 0:
            return web.json_response(
                { 'message': ret.stderr },
                status=500,
            )

        set_config(updates | { 'git_repo': git_repo })
        return web.Response(status=200)

    ret = git_set_remote_url(git_repo)
    if not ret.returncode == 0:
        return web.json_response(
            { 'message': ret.stderr },
            status=500,
        )

    set_config(updates | { 'git_repo': git_repo })
    return web.Response(status=200)

def set_config(config):
    merged = load_config() | config
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', dir=os.path.dirname(config_path), encoding='utf-8', delete=False) as f:
            temporary = f.name
            json.dump(merged, f, indent=2)
            f.write('\n')
        os.replace(temporary, config_path)
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)
    for function in (get_config, collections_path, outputs_path, sources_path, download_logs_path):
        function.cache_clear()

def git_set_remote_url(remote_url, run_path = collections_path()):
    remote_url = shlex.quote(remote_url)
    ret = run_cmd('git remote', run_path)

    if git_remote_name in ret.stdout.split('\n'):
        return run_cmd(f'git remote set-url {git_remote_name} {remote_url}', run_path)
    else:
        return run_cmd(f'git remote add {git_remote_name} {remote_url}', run_path)
