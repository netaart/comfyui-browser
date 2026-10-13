import dayjs from 'dayjs';
import type Toast from './Toast.svelte';

export type FOLDER_TYPES = 'outputs' | 'collections' | 'sources';

export const IMAGE_EXTS = ['png', 'webp', 'jpeg', 'jpg', 'gif'];
export const VIDEO_EXTS = ['mp4', 'webm', 'mov', 'avi', 'mkv'];
export const JSON_EXTS = ['json'];
export const WHITE_EXTS = ['html', 'image', 'video', 'json', 'dir'];

const localStorageKey = 'comfyui-browser';

function getFileUrl(comfyUrl: string, folderType: string, file: any) {
  const filename = encodeURIComponent(file.name);
  const folderPath = (file.folder_path || '').split('/').map(encodeURIComponent).join('/');
  if (file.folder_path) {
    return `${comfyUrl}/browser/s/${folderType}/${folderPath}/${filename}`;
  } else {
    return `${comfyUrl}/browser/s/${folderType}/${filename}`;
  }
}

function findFile(filename: string, exts: Array<string>, files: Array<any>) {
  let fn: any = filename.split('.');
  fn.pop();
  fn = fn.join('.');
  return files.find((f: any) => {
    const fa = f.name.split('.');
    const extname = fa.pop().toLowerCase();
    const name = fa.join('.');

    return name === fn && exts.includes(extname);
  });
}

function processFile(
  file: any,
  folderType: FOLDER_TYPES,
  comfyUrl: string,
  files: Array<any>,
) {
  const extname = file.name.split('.').pop().toLowerCase();
  if (WHITE_EXTS.includes(extname)) {
    file['fileType'] = extname;
    if (extname === 'json') {
      if (findFile(file.name, IMAGE_EXTS.concat(VIDEO_EXTS), files)) {
        return;
      }
    }
  }
  if (IMAGE_EXTS.includes(extname)) {
    file['fileType'] = 'image';
  }
  if (VIDEO_EXTS.includes(extname)) {
    file['fileType'] = 'video';
  }
  if (! file['fileType']) {
    return;
  }

  file['url'] = getFileUrl(comfyUrl, folderType, file);
  file['originalUrl'] = file['url'];
  const params = new URLSearchParams({folder_type: folderType, folder_path: file.folder_path || '', filename: file.name});
  file['downloadUrl'] = `${comfyUrl}/browser/files/view?${params}&download=1`;
  if (['image', 'video'].includes(file['fileType'])) {
    file['previewUrl'] = `${comfyUrl}/browser/files/thumbnail?${params}&v=${file.mtime_ns || file.modified_at || ''}`;

    let jsonFile = findFile(file.name, JSON_EXTS, files);
    if (jsonFile) {
      file['url'] = getFileUrl(comfyUrl, folderType, jsonFile);
    }
  }

  const d = dayjs.unix(file.modified_at ?? file.created_at);
  file['formattedDatetime'] = d.format('YYYY-MM-DD HH:mm:ss');
  file['formattedSize'] = formatFileSize(file['bytes']);

  return file;
}

function processDir(dir: any) {
  dir['fileType'] = 'dir';

  const newFolderPath = dir.folder_path ? `${dir.folder_path}/${dir.name}` : dir.name;
  dir['path'] = newFolderPath;

  const d = dayjs.unix(dir.modified_at ?? dir.created_at);
  dir['formattedDatetime'] = d.format('YYYY-MM-DD HH-mm-ss');

  dir['formattedSize'] = '0 KB';
  return dir;
}

export async function fetchFiles(
  folderType: FOLDER_TYPES,
  comfyUrl: string,
  folderPath?: string,
) {
  const url = comfyUrl + '/browser/files?' + new URLSearchParams({folder_type: folderType, folder_path: folderPath || ''});

  const res = await fetch(url);
  if (!res.ok) throw new Error(await res.text() || 'Could not load files');
  const ret = await res.json();

  let files = ret.files;
  let newFiles: Array<any> = [];
  files.forEach((f: any) => {
    let newFile;
    if (f.type === 'dir') {
      newFile = processDir(f);
    } else {
      newFile = processFile(f, folderType, comfyUrl, files);
    }

    if (newFile) {
      newFiles.push(newFile);
    }
  });

  return newFiles;
}

export function onScroll(showCursor: number, filesLen: number) {
  if (showCursor >= filesLen) {
    return showCursor;
  }

  const documentHeight = document.documentElement.scrollHeight;
  const scrollPosition = window.innerHeight + window.scrollY;
  if (scrollPosition >= documentHeight) {
    return showCursor + 10;
  }

  return showCursor;
}

export async function onLoadWorkflow(file: any, comfyApp: any, toast: Toast) {
  const res = await fetch(file.url);
  const blob = await res.blob();
  const fileObj = new File([blob], file.name, {
    type: res.headers.get('Content-Type') || '',
  });
  const f = comfyApp.loadGraphData.bind(comfyApp);
  comfyApp.loadGraphData = async function(graphData: any) {
    const modal = window.top?.document.getElementById('comfy-browser-dialog');
    if (modal) {
      modal.style.display = 'none';
    }
    await f(graphData);
  }
  await comfyApp.handleFile(fileObj);

  toast.show(false, 'Loaded', 'No workflow found here');
}


export function getLocalConfig() {
  let localConfigStr = localStorage.getItem(localStorageKey);
  let localConfig: any = {};

  if (localConfigStr) {
    try { localConfig = JSON.parse(localConfigStr) || {}; } catch { localConfig = {}; }
  }

  return localConfig;
}

export function setLocalConfig(key: string, value: any) {
  let localConfig = getLocalConfig();
  localConfig[key] = value;
  localStorage.setItem(localStorageKey, JSON.stringify(localConfig));
}

export function formatFileSize(size: number) {
  if (size >= 1024 ** 3) {
    return (size / 1024 ** 3).toFixed(2) + ' GB';
  } else if (size / 1024 / 1024 > 1) {
    return (size / 1024 / 1024).toFixed(2) + ' MB';
  } else {
    return Math.round(size / 1024) + ' KB';
  }
}

const filenameCollator = new Intl.Collator(undefined, {numeric: true, sensitivity: 'base'});
export function sortBrowserFiles(files: any[], field = 'name', order = 'asc') {
  const direction = order === 'desc' ? -1 : 1;
  return [...files].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    const byName = filenameCollator.compare(a.name, b.name);
    let result = byName;
    if (field === 'mtime') result = (a.modified_at || 0) - (b.modified_at || 0);
    if (field === 'size') result = a.bytes - b.bytes;
    if (field === 'type') result = filenameCollator.compare(a.name.split('.').pop(), b.name.split('.').pop());
    return result ? direction * result : byName;
  });
}
