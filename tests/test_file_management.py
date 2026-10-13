"""Run with: python -m unittest discover -s tests -v (no ComfyUI/GPU required)."""
import asyncio
import importlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import types
import unittest
from unittest.mock import patch
import zipfile

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
bootstrap = tempfile.TemporaryDirectory()
package = types.ModuleType('browser_under_test')
package.__path__ = [str(ROOT)]
sys.modules[package.__name__] = package
folder_paths = types.ModuleType('folder_paths')
folder_paths.get_output_directory = lambda: bootstrap.name
sys.modules['folder_paths'] = folder_paths
cli = types.ModuleType('comfy.cli_args')
cli.args = types.SimpleNamespace(listen='127.0.0.1', port=8188, output_directory=bootstrap.name)
sys.modules['comfy'] = types.ModuleType('comfy')
sys.modules['comfy.cli_args'] = cli
utils = importlib.import_module('browser_under_test.utils')
files = importlib.import_module('browser_under_test.routes.files')
config = importlib.import_module('browser_under_test.routes.config')
archives = importlib.import_module('browser_under_test.routes.archives')
thumbnails = importlib.import_module('browser_under_test.routes.thumbnails')


class FileManagementTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.output = self.base / 'output'
        self.output.mkdir()
        self.config_path = self.base / 'config.json'
        self.config_path.write_text(json.dumps({
            'outputs': str(self.output), 'thumbnail_cache': str(self.base / 'cache'),
            'collections': str(self.base / 'collections'), 'git_repo': 'https://example.com/workflows.git',
            'custom_setting': 'keep me',
        }))
        self.patches = [patch.object(utils, 'config_path', str(self.config_path)),
                        patch.object(config, 'config_path', str(self.config_path)),
                        patch.object(archives, 'archive_slots', asyncio.Semaphore(1)),
                        patch.object(thumbnails, 'preview_slots', asyncio.Semaphore(2))]
        for mock in self.patches:
            mock.start()
        for function in (utils.get_config, utils.outputs_path, utils.collections_path,
                         utils.download_logs_path, utils.sources_path):
            function.cache_clear()
        app = web.Application()
        app.add_routes([
            web.get('/files', files.api_get_files),
            web.delete('/files', files.api_delete_file),
            web.put('/files', files.api_update_file),
            web.get('/view', files.api_view_file),
            web.post('/archive', archives.api_download_archive),
            web.get('/thumbnail', thumbnails.api_thumbnail),
            web.get('/cache', thumbnails.api_cache_status),
            web.delete('/cache', thumbnails.api_cache_status),
            web.put('/config', config.api_update_browser_config),
            web.get('/s/{relative_path:.*}', files.api_static_output),
        ])
        self.client = TestClient(TestServer(app))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        for mock in reversed(self.patches):
            mock.stop()
        self.temp.cleanup()

    def image(self, name='image 2.png', color='red'):
        target = self.output / name
        Image.new('RGB', (800, 400), color).save(target)
        return target

    async def test_sort_metadata_natural_and_directories_first(self):
        (self.output / 'z-folder').mkdir()
        self.image('image 10.png')
        p = self.image()
        os.utime(p, (1000, 1000))
        for direction, expected in [('asc', ['z-folder', 'image 2.png', 'image 10.png']),
                                     ('desc', ['z-folder', 'image 10.png', 'image 2.png'])]:
            response = await self.client.get('/files', params={'sort_by': 'name', 'order': direction})
            entries = (await response.json())['files']
            self.assertEqual([f['name'] for f in entries], expected)
            self.assertTrue(all('modified_at' in f and 'mtime_ns' in f for f in entries))
        response = await self.client.get('/files?sort_by=mtime&order=asc')
        self.assertEqual((await response.json())['files'][1]['name'], 'image 2.png')
        response = await self.client.get('/files?sort_by=invalid')
        self.assertEqual(response.status, 400)
        for field in ('size', 'type'):
            response = await self.client.get('/files', params={'sort_by': field, 'order': 'desc'})
            self.assertEqual((await response.json())['files'][0]['type'], 'dir')

    async def test_paths_cannot_escape_root(self):
        outside = self.base / 'private.png'
        outside.write_bytes(b'private')
        (self.output / 'escape.png').symlink_to(outside)
        for name in ('../private.png', str(outside), 'C:\\private.png', 'escape.png'):
            response = await self.client.get('/view', params={'filename': name})
            self.assertEqual(response.status, 400, name)
            response = await self.client.get('/thumbnail', params={'filename': name})
            self.assertEqual(response.status, 400, name)
        response = await self.client.delete('/files', json={'filename': 'escape.png'})
        self.assertEqual(response.status, 400)
        response = await self.client.delete('/files', json={'filename': '.'})
        self.assertEqual(response.status, 400)
        self.assertTrue(outside.exists())
        response = await self.client.get('/files', params={'folder_path': str(self.base)})
        self.assertEqual(response.status, 400)
        response = await self.client.get('/files')
        self.assertEqual((await response.json())['files'], [])

    async def test_root_changes_live_and_preserves_settings(self):
        self.image()
        new_root = self.base / 'new-output'
        new_root.mkdir()
        (new_root / 'new.json').write_text('{"new": true}')
        response = await self.client.put('/config', json={'outputs': str(new_root), 'thumbnail_size': 256})
        self.assertEqual(response.status, 200)
        response = await self.client.get('/s/new.json')
        self.assertEqual(await response.json(), {'new': True})
        response = await self.client.get('/s/image%202.png')
        self.assertEqual(response.status, 404)
        saved = json.loads(self.config_path.read_text())
        self.assertEqual(saved['git_repo'], 'https://example.com/workflows.git')
        self.assertEqual(saved['custom_setting'], 'keep me')
        config.set_config({'git_repo': 'https://example.com/new.git'})
        self.assertEqual(utils.outputs_path(), str(new_root))
        response = await self.client.put('/config', json={'outputs': 'relative/path'})
        self.assertEqual(response.status, 400)
        response = await self.client.put('/config', json={'thumbnail_cache_mb': -1})
        self.assertEqual(response.status, 400)

    async def test_delete_internal_symlink_preserves_its_target(self):
        original = self.image()
        link = self.output / 'alias.png'
        link.symlink_to(original)
        response = await self.client.delete('/files', json={'filename': link.name})
        self.assertEqual(response.status, 201)
        self.assertFalse(link.exists())
        self.assertTrue(original.exists())

    async def test_single_download_filename_and_range(self):
        original = self.image('雪 # & image.png')
        response = await self.client.get('/view', params={'filename': original.name, 'download': '1'},
                                         headers={'Range': 'bytes=0-9'})
        self.assertEqual(response.status, 206)
        self.assertEqual(await response.read(), original.read_bytes()[:10])
        self.assertIn('attachment;', response.headers['Content-Disposition'])
        self.assertIn('%23', response.headers['Content-Disposition'])

    async def test_archives_preserve_originals_and_optional_workflows(self):
        original = self.image('雪 # image.png')
        (self.output / '雪 # image.json').write_text('{"workflow": 42}')
        for archive_format in ('zip', 'tar.gz'):
            payload = {'files': [original.name, original.name], 'format': archive_format}
            response = await self.client.post('/archive', data={'payload': json.dumps(payload)})
            self.assertEqual(response.status, 200)
            data = io.BytesIO(await response.read())
            if archive_format == 'zip':
                with zipfile.ZipFile(data) as archive:
                    self.assertEqual(set(archive.namelist()), {original.name, '雪 # image.json'})
                    self.assertEqual(archive.read(original.name), original.read_bytes())
            else:
                with tarfile.open(fileobj=data) as archive:
                    self.assertEqual(set(archive.getnames()), {original.name, '雪 # image.json'})
                    self.assertEqual(archive.extractfile(original.name).read(), original.read_bytes())
        response = await self.client.post('/archive', json={'files': [original.name], 'include_workflows': False})
        with zipfile.ZipFile(io.BytesIO(await response.read())) as archive:
            self.assertEqual(archive.namelist(), [original.name])

    async def test_archive_rejects_missing_directories_escapes_and_limits(self):
        self.image()
        for names in ([], ['../secret.png'], ['missing.png'], ['.'], ['image 2.png'] * 5001):
            response = await self.client.post('/archive', json={'files': names})
            self.assertEqual(response.status, 400)
        with patch.object(archives, 'MAX_BYTES', 1):
            response = await self.client.post('/archive', json={'files': ['image 2.png']})
            self.assertEqual(response.status, 400)

    async def test_thumbnail_reuse_invalidation_and_clear(self):
        original = self.image()
        original_bytes = original.read_bytes()
        response = await self.client.get('/thumbnail', params={'filename': original.name})
        self.assertEqual(response.status, 200)
        first = await response.read()
        etag = response.headers['ETag']
        with Image.open(io.BytesIO(first)) as preview:
            self.assertEqual(preview.size, (384, 192))
        self.assertEqual(original.read_bytes(), original_bytes)
        with patch.object(thumbnails.Image, 'open', side_effect=AssertionError('Cache should be reused')):
            response = await self.client.get('/thumbnail', params={'filename': original.name}, headers={'If-None-Match': etag})
            self.assertEqual(response.status, 304)
        self.image(color='blue')
        response = await self.client.get('/thumbnail', params={'filename': original.name})
        self.assertNotEqual(response.headers['ETag'], etag)
        self.assertNotEqual(await response.read(), first)
        response = await self.client.delete('/cache')
        self.assertEqual((await response.json())['files'], 0)
        self.assertTrue(original.exists())

    async def test_thumbnail_cache_evicts_old_entries_only(self):
        cache = thumbnails.cache_dir()
        cache.mkdir()
        stale = cache / ('a' * 64 + '.webp')
        stale.write_bytes(b'0' * (17 * 1024 ** 2))
        os.utime(stale, (1000, 1000))
        unrelated = cache / 'keep.txt'
        unrelated.write_text('unrelated')
        config.set_config({'thumbnail_cache_mb': 16})
        original = self.image()
        response = await self.client.get('/thumbnail', params={'filename': original.name})
        self.assertEqual(response.status, 200)
        self.assertFalse(stale.exists())
        self.assertTrue(unrelated.exists())

    @unittest.skipUnless(shutil.which('ffmpeg'), 'FFmpeg unavailable')
    async def test_video_thumbnail_and_missing_ffmpeg(self):
        target = self.output / 'clip.mp4'
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=0.2',
                        '-c:v', 'mpeg4', str(target)], check=True)
        response = await self.client.get('/thumbnail', params={'filename': target.name})
        self.assertEqual(response.status, 200)
        with Image.open(io.BytesIO(await response.read())) as preview:
            self.assertLessEqual(max(preview.size), 384)
        await self.client.delete('/cache')
        with patch.object(thumbnails.shutil, 'which', return_value=None):
            response = await self.client.get('/thumbnail', params={'filename': target.name})
            self.assertEqual(response.status, 400)


if __name__ == '__main__':
    unittest.main()
