import dayjs from 'dayjs';
import type Toast from './Toast.svelte';

export type FOLDER_TYPES = 'outputs' | 'collections' | 'sources';

export const IMAGE_EXTS = ['png', 'webp', 'jpeg', 'jpg', 'gif', 'svg'];
export const VIDEO_EXTS = ['mp4', 'webm', 'mov', 'avi', 'mkv'];
export const AUDIO_EXTS = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'];
export const TEXT_EXTS = ['txt', 'md', 'csv', 'log', 'html', 'json'];
export const JSON_EXTS = ['json'];
export const WHITE_EXTS = ['html', 'image', 'video', 'audio', 'text', 'markdown', 'json', 'dir'];
const SUPPORTED_FILE_EXTS = ['html', 'json', ...IMAGE_EXTS, ...VIDEO_EXTS, ...AUDIO_EXTS, ...TEXT_EXTS];

const localStorageKey = 'comfyui-browser';

export function getFileUrl(comfyUrl: string, folderType: string, file: any, rootId = 'outputs') {
  if (file.favorite_reference) {
    const params = new URLSearchParams({
      folder_type: file.source_folder_type || folderType,
      root_id: file.source_root_id || rootId,
      folder_path: file.source_folder_path || '',
      filename: file.source_filename || file.name,
    });
    return `${comfyUrl}/browser/files/view?${params.toString()}`;
  }
  if (rootId !== 'outputs') {
    const params = new URLSearchParams({
      folder_type: folderType,
      root_id: rootId,
      folder_path: file.folder_path || '',
      filename: file.name,
    });
    return `${comfyUrl}/browser/files/view?${params.toString()}`;
  }
  if (file.folder_path) {
    return `${comfyUrl}/browser/s/${folderType}/${file.folder_path}/${file.name}`;
  } else {
    return `${comfyUrl}/browser/s/${folderType}/${file.name}`;
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
  rootId: string,
) {
  const extname = file.name.split('.').pop().toLowerCase();
  if (SUPPORTED_FILE_EXTS.includes(extname)) {
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
  if (AUDIO_EXTS.includes(extname)) {
    file['fileType'] = 'audio';
  }
  if (TEXT_EXTS.includes(extname) && !['html', 'json'].includes(extname)) {
    file['fileType'] = 'text';
  }
  if (extname === 'md') {
    file['fileType'] = 'markdown';
  }
  if (! file['fileType']) {
    return;
  }

  file['url'] = getFileUrl(comfyUrl, folderType, file, rootId);
  if (['image', 'video'].includes(file['fileType'])) {
    file['previewUrl'] = getFileUrl(comfyUrl, folderType, file, rootId);

    let jsonFile = findFile(file.name, JSON_EXTS, files);
    if (jsonFile) {
      file['url'] = getFileUrl(comfyUrl, folderType, jsonFile, rootId);
    }
  }

  const d = dayjs.unix(file.created_at);
  file['formattedDatetime'] = d.format('YYYY-MM-DD HH:mm:ss');
  file['formattedSize'] = formatFileSize(file['bytes']);

  return file;
}

function processDir(dir: any, folderType: FOLDER_TYPES, comfyUrl: string, rootId: string) {
  dir['fileType'] = 'dir';

  const newFolderPath = dir.folder_path ? `${dir.folder_path}/${dir.name}` : dir.name;
  dir['path'] = dir.path || newFolderPath;
  dir['preview_items'] = (dir.preview_items || []).map((item: any) => ({
    ...item,
    previewUrl: item.fileType === 'image'
      ? getFileUrl(comfyUrl, folderType, { ...item, name: item.name, folder_path: newFolderPath }, rootId)
      : undefined,
  }));

  const d = dayjs.unix(dir.created_at);
  dir['formattedDatetime'] = d.format('YYYY-MM-DD HH:mm:ss');

  dir['formattedSize'] = formatFileSize(dir.bytes || 0);
  return dir;
}

export async function fetchFiles(
  folderType: FOLDER_TYPES,
  comfyUrl: string,
  folderPath?: string,
  rootId = 'outputs',
  pathSearch = '',
  showHidden = false,
) {
  const params = new URLSearchParams({ folder_type: folderType, root_id: rootId, folder_path: folderPath || '' });
  if (pathSearch) params.set('path_search', pathSearch);
  if (showHidden) params.set('show_hidden', '1');
  const url = `${comfyUrl}/browser/files?${params.toString()}`;

  const res = await fetch(url);
  const ret = await res.json();

  let files = ret.files;
  let newFiles: Array<any> = [];
  files.forEach((f: any) => {
    if (f.type === 'dir' && (!f.children_count || f.children_count <= 0)) return;
    let newFile;
    if (f.type === 'dir') {
      newFile = processDir(f, folderType, comfyUrl, rootId);
    } else {
      newFile = processFile(f, folderType, comfyUrl, files, rootId);
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
  const originalLoadGraphData = comfyApp.loadGraphData;
  comfyApp.loadGraphData = async function(graphData: any, ...args: any[]) {
    try {
      return await originalLoadGraphData.call(this, graphData, ...args);
    } finally {
      const modal = window.top?.document.getElementById('comfy-browser-dialog');
      if (modal) {
        modal.style.display = 'none';
      }
    }
  };
  try {
    await comfyApp.handleFile(fileObj);
  } finally {
    comfyApp.loadGraphData = originalLoadGraphData;
  }

  toast.show(false, 'Loaded', 'No workflow found here');
}


export function getLocalConfig() {
  let localConfigStr = localStorage.getItem(localStorageKey);
  let localConfig: any = {};

  if (localConfigStr) {
    localConfig = JSON.parse(localConfigStr);
  }

  return localConfig;
}

export function setLocalConfig(key: string, value: any) {
  let localConfig = getLocalConfig();
  localConfig[key] = value;
  localStorage.setItem(localStorageKey, JSON.stringify(localConfig));
}

export function formatFileSize(size: number) {
  if (size >= 1024 * 1024 * 1024) return (size / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  if (size >= 1024 * 1024) return (size / 1024 / 1024).toFixed(2) + ' MB';
  if (size >= 1024) return (size / 1024).toFixed(1) + ' KB';
  return Math.round(size) + ' B';
}
