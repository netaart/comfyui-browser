import dayjs from 'dayjs';
import type Toast from './Toast.svelte';

export type FOLDER_TYPES = 'outputs' | 'collections' | 'sources';

export const IMAGE_EXTS = ['png', 'webp', 'jpeg', 'jpg', 'gif'];
export const VIDEO_EXTS = ['mp4', 'webm', 'mov', 'avi', 'mkv'];
export const JSON_EXTS = ['json'];
export const WHITE_EXTS = ['html', 'image', 'video', 'json', 'dir'];

const localStorageKey = 'comfyui-browser';

function getFileUrl(comfyUrl: string, folderType: string, file: any) {
  if (file.folder_path) {
    return `${comfyUrl}/browser/s/${folderType}/${file.folder_path}/${file.name}`;
  } else {
    return `${comfyUrl}/browser/s/${folderType}/${file.name}`;
  }
}

function findFile(filename: string, exts: Array<string>, filesMap: Array<any>) {
  if (filesMap.allFiles.hasOwnProperty(filename)) {
      return filesMap.allFiles[filename];
  }
  return false;
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
      if (findFile(file.fullPath, IMAGE_EXTS.concat(VIDEO_EXTS), files)) {
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


  var url = getFileUrl(comfyUrl, folderType, file);
  file['url'] = url;
  if (['image', 'video'].includes(file['fileType'])) {
    file['previewUrl'] = url;
    var path = file.fullPath;
    var jsonFileName = path.substring(0, path.lastIndexOf('.')) || path;
    var jsonFileName = jsonFileName + ".json";
    let jsonFile = findFile(jsonFileName, JSON_EXTS, files);
    if (jsonFile) {
      file['url'] = getFileUrl(comfyUrl, folderType, jsonFile);
    }
  }

  const d = dayjs.unix(file.created_at);
  file['formattedDatetime'] = d.format('YYYY-MM-DD HH:mm:ss');
  file['formattedSize'] = formatFileSize(file['bytes']);

  return file;
}

function processDir(dir: any) {
  dir['fileType'] = 'dir';

  const newFolderPath = dir.folder_path ? `${dir.folder_path}/${dir.name}` : dir.name;
  dir['path'] = newFolderPath;

  const d = dayjs.unix(dir.created_at);
  dir['formattedDatetime'] = d.format('YYYY-MM-DD HH-mm-ss');

  dir['formattedSize'] = '0 KB';
  return dir;
}

export async function fetchFiles(
  folderType: FOLDER_TYPES,
  comfyUrl: string,
  folderPath?: string,
) {
  let url = comfyUrl + '/browser/files?folder_type=' + folderType;
  if (folderPath) {
    url = url + `&folder_path=${folderPath}&`;
  }

  const res = await fetch(url);
  const ret = await res.json();
  let files = ret.files;
  let newFiles: Array<any> = [];
  var map = {
    "directories": {},
    "allFiles": {}
  };

  var filesMap = files.reduce(function(map, obj) {
    var dir = (obj.type == 'dir') ? "" : obj.folder_path;
    var filePath = "/" + dir + obj.name;
    obj.fullPath = filePath;
    map.allFiles[filePath] = obj;
    if (obj.type == 'dir') {
      map.directories[filePath] = obj;
    }
    return map;
  }, map);

  files.forEach((f: any) => {
    let newFile;
    if (f.type === 'dir') {
      newFile = processDir(f);
    } else {
      newFile = processFile(f, folderType, comfyUrl, filesMap);
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
  if (size / 1024 / 1024 > 1) {
    return (size / 1024 / 1024).toFixed(2) + ' MB';
  } else {
    return Math.round(size / 1024) + ' KB';
  }
}
