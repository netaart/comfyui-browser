<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { onLoadWorkflow, onScroll, fetchFiles, WHITE_EXTS } from './utils';
  import { t } from 'svelte-i18n';
  import type { FOLDER_TYPES } from './utils';
  import MediaShow from './MediaShow.svelte';
  import DeleteTargetHint from './DeleteTargetHint.svelte';
  import { renderMarkdown } from '../../../web/markdown.js';
  import { playBrowserSound } from '../../../web/sounds.js';
  import type Toast from './Toast.svelte';
  import filenameColorConfig from './filename-color-config.json';

  export let comfyUrl: string;
  export let folderType: FOLDER_TYPES;
  export let toast: Toast;
  export let folderPath: string;
  export let navigation: any = null;
  $: if (folderPath != undefined) {
    refresh();
  }

  let comfyApp: any;
  let files: Array<any> = [];
  let pathSearchResults: Array<any> | null = null;
  let pathSearchTimer: ReturnType<typeof setTimeout> | null = null;
  let pathSearchRequestId = 0;
  let filesRequestId = 0;
  let loaded: boolean = true;
  let showCursor = 20;
  let searchQuery = '';
  let showHiddenDirectories = false;
  let candidateQuery = '';
  let searchCandidates: Array<any> = [];
  let selectedSearchCandidate = '';
  let showSearchCandidates = false;
  let searchInput: HTMLInputElement;
  let startDate = '';
  let endDate = '';
  let datePreset: 'all' | 'today' | '3days' | 'week' = 'all';
  let filteredFiles: Array<any> = [];
  let sortedFiles: Array<any> = [];
  let sortBy: 'time' | 'name' | 'size' = 'time';
  let sortDirection: 'asc' | 'desc' = 'desc';
  let scrollTop = 0;
  let folderHistory = [''];
  let folderHistoryIndex = 0;
  let canGoBack = false;
  let canGoForward = false;
  let selectedFile: any = null;
  let mouseNavigationHandled = false;
  let favoriteBusyKey = '';
  let hoveredFile: any = null;
  let deleteConfirmFile: any = null;
  let deleteHintX = 0;
  let deleteHintY = 0;
  let pointerX = 0;
  let pointerY = 0;
  let browserRoots: Array<any> = [{ id: 'outputs', name: 'Output', path: '', default: true }];
  let draggedRootId: string | null = null;
  let activeRootId = 'outputs';
  let activeRoot: any = browserRoots[0];
  let rootsLoaded = false;
  let appliedNavigationId = 0;
  let currentPathSegments: string[] = [];
  let breadcrumbOrientation: 'horizontal' | 'vertical' = 'horizontal';
  let viewMode: 'full' | 'side' = 'full';
  let newRootPath = '';
  let rootError = '';
  let rootSettingsOpen = false;
  let pickerPath = '';
  let pickerParent: string | null = null;
  let pickerDirectories: Array<any> = [];
  let pickerError = '';
  let pickerNotice = '';
  let pickerRequestId = 0;
  let pickerLoading = false;
  let standaloneBrowser = false;
  let standalonePreviewText = '';
  let standaloneTextZoom = 1;
  let standaloneTextSplit = false;
  let standaloneMarkdownPages: HTMLDivElement;
  let standaloneMarkdownPage = 1;
  let standaloneMarkdownPageCount = 1;
  // Owner: Sean — image interaction in the standalone preview.
  let standalonePreviewZoom = 1;
  let standalonePreviewPanX = 0;
  let standalonePreviewPanY = 0;
  let standalonePanOrigin: { x: number; y: number; panX: number; panY: number } | null = null;
  $: standalonePreviewHtml = selectedFile?.fileType === 'markdown'
    ? renderMarkdown(standalonePreviewText, selectedFile.url)
    : '';
  $: standalonePrettyJson = (() => {
    if (selectedFile?.fileType !== 'json') return standalonePreviewText;
    try { return JSON.stringify(JSON.parse(standalonePreviewText), null, 2); }
    catch { return standalonePreviewText; }
  })();
  $: standalonePreviewPosition = selectedFile ? getPreviewPosition(selectedFile) : { index: 0, total: 0 };

  $: searchCandidates = candidateQuery.trim()
    ? (pathSearchResults ?? files).filter((file) => matchesSearch(file, candidateQuery)).slice(0, 8)
    : [];
  $: activeRoot = folderType === 'outputs'
    ? (browserRoots.find((root) => root.id === activeRootId) || browserRoots[0])
    : null;
  $: if (navigation && rootsLoaded && navigation.id !== appliedNavigationId) {
    appliedNavigationId = navigation.id;
    void openNavigationTarget(navigation);
  }
  $: currentPathSegments = (folderPath || '').split('/').filter(Boolean);
  $: filteredFiles = (pathSearchResults ?? files).filter((file) => {
    if (!matchesSearch(file, searchQuery)) return false;
    if (!startDate && !endDate) return true;
    const createdAt = Number(file.created_at);
    if (!Number.isFinite(createdAt)) return false;
    const date = dateInputValue(new Date(createdAt * 1000));
    return (!startDate || date >= startDate) && (!endDate || date <= endDate);
  });
  $: sortedFiles = sortFiles(filteredFiles, sortBy, sortDirection);

  function matchesSearch(file: any, query: string) {
    const needle = query.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLocaleLowerCase();
    if (!needle) return true;
    const relativePath = [file.folder_path, file.name]
      .filter(Boolean)
      .join('/')
      .replace(/\\/g, '/')
      .toLocaleLowerCase();
    return relativePath.includes(needle);
  }

  function sortFiles(source: Array<any>, key: 'time' | 'name' | 'size', direction: 'asc' | 'desc') {
    const sign = direction === 'asc' ? 1 : -1;
    return [...source].sort((a, b) => {
      const directoryOrder = Number(a.type === 'file') - Number(b.type === 'file');
      if (directoryOrder) return directoryOrder;
      let result = 0;
      if (key === 'name') {
        result = String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: 'base' });
      } else {
        const field = key === 'time' ? 'created_at' : 'bytes';
        result = (Number(a[field]) || 0) - (Number(b[field]) || 0);
      }
      return result === 0 ? String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: 'base' }) : result * sign;
    });
  }

  function setSortBy(value: 'time' | 'name' | 'size') {
    sortBy = value;
    showCursor = 20;
    localStorage.setItem('comfyui-browser-sort-by', sortBy);
  }

  function onSortChange(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (value === 'time' || value === 'name' || value === 'size') setSortBy(value);
  }

  function toggleSortDirection() {
    sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    showCursor = 20;
    localStorage.setItem('comfyui-browser-sort-direction', sortDirection);
  }

  function wordColor(word: string) {
    const normalized = word.toLowerCase();
    if (filenameColorConfig.wordColors[normalized]) return filenameColorConfig.wordColors[normalized];
    for (const category of Object.values(filenameColorConfig.categories)) {
      if (category.terms.includes(normalized)) return category.color;
    }
    if (normalized.length === 1 && filenameColorConfig.stageLetters[normalized]) return filenameColorConfig.stageLetters[normalized];
    let hash = 0;
    for (const char of normalized) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
    return filenameColorConfig.fallbackPalette[hash % filenameColorConfig.fallbackPalette.length];
  }

  function filenameSegments(name: string, isFile: boolean) {
    const extensionIndex = isFile ? name.lastIndexOf('.') : -1;
    const hasExtension = extensionIndex > 0;
    const stem = hasExtension ? name.slice(0, extensionIndex) : name;
    const leadingDot = !isFile && stem.startsWith('.');
    const words = stem.slice(leadingDot ? 1 : 0).match(/[\p{L}\p{N}]+/gu) || [stem.slice(leadingDot ? 1 : 0)];
    const segments: Array<{ text: string; color: string }> = [
      ...(leadingDot ? [{ text: '.', color: 'rgba(255,255,255,.8)' }] : []),
      ...words.map((text) => ({
      text,
      color: /^\p{N}+$/u.test(text)
        ? filenameColorConfig.numberColor
        : /^\p{L}+$/u.test(text)
          ? wordColor(text)
          : 'rgba(255,255,255,.55)',
      })),
    ];
    return segments;
  }

  function filenameColumns(name: string, isFile: boolean) {
    const segments = filenameSegments(name, isFile);
    const maxLines = 3;
    let usedLines = 0;
    let splitAt = segments.length;
    for (let index = 0; index < segments.length; index += 1) {
      const lineUnits = Array.from(segments[index].text).reduce(
        (total, char) => total + (/\p{Script=Han}/u.test(char) ? 2 : 1),
        0,
      );
      const neededLines = Math.max(1, Math.ceil(lineUnits / 9));
      if (index > 0 && usedLines + neededLines > maxLines) {
        splitAt = index;
        break;
      }
      usedLines += neededLines;
      if (usedLines >= maxLines && index + 1 < segments.length) {
        splitAt = index + 1;
        break;
      }
    }
    return [segments.slice(0, splitAt), segments.slice(splitAt)];
  }

  function dateInputValue(date: Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function setDatePreset(preset: 'all' | 'today' | '3days' | 'week') {
    if (datePreset === preset) preset = 'all';
    datePreset = preset;
    showCursor = 20;
    if (preset === 'all') {
      startDate = '';
      endDate = '';
      return;
    }
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (preset === '3days') start.setDate(start.getDate() - 2);
    if (preset === 'week') start.setDate(start.getDate() - 6);
    startDate = dateInputValue(start);
    endDate = dateInputValue(today);
  }

  function onSearchInput() {
    const requestId = ++pathSearchRequestId;
    candidateQuery = searchQuery;
    selectedSearchCandidate = '';
    showSearchCandidates = true;
    showCursor = 20;
    if (pathSearchTimer) clearTimeout(pathSearchTimer);
    const query = searchQuery.trim();
    if (!query) {
      pathSearchResults = null;
      return;
    }
    if (folderType !== 'outputs') {
      pathSearchResults = null;
      return;
    }
    pathSearchTimer = setTimeout(async () => {
      try {
        // Search every query from the selected root, including hidden production
        // folders, so a filename alone can find files outside the open directory.
        const results = await fetchFiles(folderType, comfyUrl, '', activeRootId, query, true);
        if (requestId === pathSearchRequestId && searchQuery.trim() === query) pathSearchResults = results;
      } catch {
        if (requestId === pathSearchRequestId) pathSearchResults = [];
      }
    }, 250);
  }

  function toggleShowHiddenDirectories(event: Event) {
    showHiddenDirectories = (event.currentTarget as HTMLInputElement).checked;
    localStorage.setItem('comfyui-browser-show-hidden-directories', String(showHiddenDirectories));
    void refresh();
    if (searchQuery.trim() && (searchQuery.includes('/') || searchQuery.includes('\\') || searchQuery.startsWith('.'))) {
      onSearchInput();
    }
  }

  function searchCandidatePath(candidate: any) {
    return [candidate.folder_path, candidate.name].filter(Boolean).join('/');
  }

  function selectSearchCandidate(candidate: any) {
    const candidatePath = searchCandidatePath(candidate);
    if (candidate.type === 'dir') {
      showSearchCandidates = false;
      onClickDir(candidate);
      return;
    }
    selectedSearchCandidate = candidatePath;
    searchQuery = candidatePath;
    showSearchCandidates = false;
    showCursor = 20;
  }

  function onSearchKeydown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      searchInput?.focus();
      searchInput?.select();
      return;
    }
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && searchCandidates.length > 0) {
      event.preventDefault();
      showSearchCandidates = true;
      const currentIndex = searchCandidates.findIndex((candidate) => searchCandidatePath(candidate) === selectedSearchCandidate);
      const nextIndex = event.key === 'ArrowDown'
        ? (currentIndex + 1) % searchCandidates.length
        : (currentIndex <= 0 ? searchCandidates.length - 1 : currentIndex - 1);
      const nextCandidate = searchCandidates[nextIndex];
      selectSearchCandidate(nextCandidate);
      if (nextCandidate.type !== 'dir') showSearchCandidates = true;
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (searchCandidates.length > 0 && !selectedSearchCandidate) selectSearchCandidate(searchCandidates[0]);
      else showSearchCandidates = false;
    } else if (event.key === 'Escape') {
      event.preventDefault();
      searchQuery = '';
      pathSearchResults = null;
      candidateQuery = '';
      selectedSearchCandidate = '';
      showSearchCandidates = false;
      showCursor = 20;
    }
  }

  function onSearchShortcut(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') onSearchKeydown(event);
  }

  function toggleHostViewMode() {
    if (window.top === window) {
      setViewMode(viewMode === 'side' ? 'full' : 'side');
      return;
    }
    window.top?.postMessage({ source: 'comfyui-browser', type: 'toggle-view-mode' }, '*');
  }

  function sizeColor(bytes: number) {
    if (bytes >= 1024 ** 3) return '#fca5a5';
    if (bytes >= 500 * 1024 ** 2) return '#fdba74';
    if (bytes >= 100 * 1024 ** 2) return '#fcd34d';
    if (bytes >= 10 * 1024 ** 2) return '#bef264';
    if (bytes >= 1024 ** 2) return '#86efac';
    return '#a5f3fc';
  }

  function dateColor(createdAt: number) {
    const created = new Date(createdAt * 1000);
    const ageMs = Math.max(0, Date.now() - created.getTime());
    if (ageMs < 60 * 60 * 1000) return '#ffffff';
    if (ageMs < 3 * 60 * 60 * 1000) return '#f4f4f5';
    const now = new Date();
    const isToday = created.getFullYear() === now.getFullYear()
      && created.getMonth() === now.getMonth()
      && created.getDate() === now.getDate();
    if (isToday) return '#e4e4e7';
    return '#d4d4d8';
  }

  $: tt = function(key: string) {
    return $t('filesList.' + key);
  }

  export async function refresh() {
    const requestId = ++filesRequestId;
    const requestedFolder = folderPath;
    const requestedRoot = activeRootId;
    loaded = false;
    try {
      const nextFiles = await fetchFiles(folderType, comfyUrl, requestedFolder, requestedRoot, '', showHiddenDirectories);
      if (requestId === filesRequestId) files = nextFiles;
    } finally {
      if (requestId === filesRequestId) loaded = true;
    }
  }

  onMount(async () => {
    standaloneBrowser = window.top === window;
    showHiddenDirectories = localStorage.getItem('comfyui-browser-show-hidden-directories') === 'true';
    const savedSortBy = localStorage.getItem('comfyui-browser-sort-by');
    if (savedSortBy === 'time' || savedSortBy === 'name' || savedSortBy === 'size') sortBy = savedSortBy;
    const savedSortDirection = localStorage.getItem('comfyui-browser-sort-direction');
    if (savedSortDirection === 'asc' || savedSortDirection === 'desc') sortDirection = savedSortDirection;
    const savedOrientation = localStorage.getItem('comfyui-browser-breadcrumb-orientation');
    if (savedOrientation === 'horizontal' || savedOrientation === 'vertical') breadcrumbOrientation = savedOrientation;
    //@ts-ignore
    comfyApp = window.top.app;

    //@ts-ignore
    window.top.addEventListener("comfyuiBrowserShow", () => {
      refresh();
    });

    window.addEventListener('message', onHostMessage);
    viewMode = hostViewMode() || viewMode;
    if (folderType === 'outputs') {
      try {
        const response = await fetch(comfyUrl + '/browser/roots');
        if (response.ok) {
          const result = await response.json();
          browserRoots = result.roots || browserRoots;
        }
      } catch {
        rootError = 'Could not load directories';
      }
      viewMode = hostViewMode() || viewMode;
      const storedRoot = localStorage.getItem(rootStorageKey()) || localStorage.getItem(`comfyui-browser-root-${viewMode}`);
      if (browserRoots.some((root) => root.id === storedRoot)) activeRootId = storedRoot;
      const storedFolder = localStorage.getItem(folderStorageKey()) ?? localStorage.getItem(`comfyui-browser-folder-${viewMode}`) ?? '';
      folderPath = storedFolder;
      localStorage.setItem(rootStorageKey(), activeRootId);
      localStorage.setItem(folderStorageKey(), folderPath);
    }

    rootsLoaded = true;

    resetFolderHistory();

    window.addEventListener('scroll', (e) => {
      showCursor = onScroll(showCursor, files.length);
      //@ts-ignore
      scrollTop = (e.target.scrollingElement as HTMLElement).scrollTop;
    });
    window.addEventListener('keydown', onFolderShortcut);
    window.addEventListener('keydown', onFileShortcut);
    window.addEventListener('keydown', onPreviewNavigateKey);
    window.addEventListener('keydown', onSearchShortcut);
    window.addEventListener('pointerdown', onMouseNavigationCapture, true);
    window.addEventListener('pointerup', onMouseNavigationCapture, true);
    window.addEventListener('mousedown', onMouseNavigationCapture, true);
    window.addEventListener('mouseup', onMouseNavigationCapture, true);
    window.addEventListener('auxclick', onMouseNavigationCapture, true);
    window.addEventListener('pointermove', onGlobalPointerMove);
  });

  async function openNavigationTarget(target: any) {
    if (folderType !== 'outputs') return;
    const targetRootId = browserRoots.some((root) => root.id === target.rootId) ? target.rootId : 'outputs';
    const targetPath = [target.folderPath, target.folderName].filter(Boolean).join('/');
    syncViewMode();
    activeRootId = targetRootId;
    folderPath = targetPath;
    searchQuery = '';
    candidateQuery = '';
    pathSearchResults = null;
    pathSearchRequestId += 1;
    localStorage.setItem(rootStorageKey(), activeRootId);
    localStorage.setItem(folderStorageKey(), folderPath);
    selectedFile = null;
    postPreview(null);
    resetFolderHistory();
    window.scrollTo({ top: 0 });
    await refresh();
  }

  onDestroy(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', onFolderShortcut);
      window.removeEventListener('keydown', onFileShortcut);
      window.removeEventListener('keydown', onPreviewNavigateKey);
      window.removeEventListener('keydown', onSearchShortcut);
      window.removeEventListener('pointerdown', onMouseNavigationCapture, true);
      window.removeEventListener('pointerup', onMouseNavigationCapture, true);
      window.removeEventListener('mousedown', onMouseNavigationCapture, true);
      window.removeEventListener('mouseup', onMouseNavigationCapture, true);
      window.removeEventListener('auxclick', onMouseNavigationCapture, true);
      window.removeEventListener('pointermove', onGlobalPointerMove);
      window.removeEventListener('message', onHostMessage);
      postPreview(null);
    }
  });

  function rootStorageKey() {
    return 'comfyui-browser-root';
  }

  function folderStorageKey() {
    return 'comfyui-browser-folder';
  }

  function hostViewMode(): 'full' | 'side' | null {
    try {
      const mode = (window.top as any).__comfyuiBrowserViewMode;
      return mode === 'full' || mode === 'side' ? mode : null;
    } catch {
      return null;
    }
  }

  function syncViewMode(): 'full' | 'side' {
    const mode = hostViewMode();
    if (mode && mode !== viewMode) setViewMode(mode);
    return mode || viewMode;
  }

  function onHostMessage(event: MessageEvent) {
    if (event.source !== window.top || event.data?.source !== 'comfyui-browser-host') return;
    if (event.data.type === 'view-mode' && (event.data.mode === 'full' || event.data.mode === 'side')) {
      setViewMode(event.data.mode);
    }
    if (event.data.type === 'dismiss-root-settings') rootSettingsOpen = false;
    if (event.data.type === 'preview-closed') selectedFile = null;
    if (event.data.type === 'preview-navigate') navigatePreview(Number(event.data.direction), Boolean(event.data.jumpToEdge));
    if (event.data.type === 'browser-mouse-navigate') {
      const direction = Number(event.data.direction);
      if (selectedFile) navigatePreview(direction, Boolean(event.data.jumpToEdge));
      else direction < 0 ? goBack() : goForward();
    }
  }

  function navigatePreview(direction: number, jumpToEdge = false) {
    if (!selectedFile || !direction) { toast?.invalid(); return; }
    const previewable = sortedFiles.filter((file) => file.type === 'file').slice(0, showCursor);
    if (previewable.length === 0) { toast?.invalid(); return; }
    const index = previewable.findIndex((file) => file.name === selectedFile.name && file.folder_path === selectedFile.folder_path);
    const next = previewable[jumpToEdge ? (direction < 0 ? 0 : previewable.length - 1) : index + direction];
    if (next && (next.name !== selectedFile.name || next.folder_path !== selectedFile.folder_path)) {
      playBrowserSound('navigate');
      void onSelectFile(next, false);
      requestAnimationFrame(() => {
        const card = Array.from(document.querySelectorAll<HTMLElement>('[data-preview-file]'))
          .find((item) => item.dataset.previewFile === next.name && item.dataset.previewFolder === next.folder_path);
        card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    }
    else toast?.invalid();
  }

  function getPreviewPosition(file: any) {
    const previewable = sortedFiles.filter((item) => item.type === 'file').slice(0, showCursor);
    const index = previewable.findIndex((item) => item.name === file.name);
    return { index: Math.max(0, index) + 1, total: previewable.length };
  }

  function onPreviewNavigateKey(event: KeyboardEvent) {
    if (!selectedFile) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      selectedFile = null;
      postPreview(null);
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
    const textPreview = ['text', 'html', 'json', 'markdown'].includes(selectedFile.fileType);
    if (textPreview && ['+', '=', 'Add'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation(); changeTextZoom(0.1); return;
    }
    if (textPreview && ['-', '_', 'Subtract'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation(); changeTextZoom(-0.1); return;
    }
    if (textPreview && event.key === '0') {
      event.preventDefault(); event.stopPropagation(); standaloneTextZoom = 1; return;
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();
    navigatePreview(event.key === 'ArrowLeft' ? -1 : 1);
  }

  function setViewMode(mode: 'full' | 'side') {
    viewMode = mode;
  }

  async function selectBrowserRoot(rootId: string) {
    syncViewMode();
    activeRootId = rootId;
    searchQuery = '';
    candidateQuery = '';
    pathSearchResults = null;
    pathSearchResults = null;
    pathSearchRequestId += 1;
    localStorage.setItem(rootStorageKey(), activeRootId);
    folderPath = '';
    localStorage.setItem(folderStorageKey(), folderPath);
    selectedFile = null;
    postPreview(null);
    resetFolderHistory();
    refresh();
    rootSettingsOpen = false;
  }

  async function loadPickerDirectory(path?: string) {
    const requestId = ++pickerRequestId;
    pickerLoading = true;
    pickerError = '';
    pickerNotice = '';
    try {
      const params = new URLSearchParams();
      if (path) params.set('path', path);
      const response = await fetch(`${comfyUrl}/browser/roots/directories?${params.toString()}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Could not read directory');
      if (requestId !== pickerRequestId) return;
      pickerPath = result.path;
      pickerParent = result.parent;
      pickerDirectories = result.directories || [];
    } catch (error) {
      if (requestId === pickerRequestId) pickerError = String(error);
    } finally {
      if (requestId === pickerRequestId) pickerLoading = false;
    }
  }

  async function selectPickerDirectory(path: string) {
    await loadPickerDirectory(path);
    await copyDirectoryPath(path);
  }

  async function copyDirectoryPath(path: string) {
    if (!path) return;
    try {
      await navigator.clipboard.writeText(path);
      pickerNotice = `Copied: ${path}`;
    } catch {
      pickerError = 'Could not copy path';
    }
  }

  async function toggleRootSettings() {
    rootSettingsOpen = !rootSettingsOpen;
    if (rootSettingsOpen) {
      const activeRoot = browserRoots.find((root) => root.id === activeRootId);
      await loadPickerDirectory(activeRoot?.path);
    }
  }

  async function addBrowserRoot() {
    syncViewMode();
    rootError = '';
    let pathToAdd = newRootPath.trim();
    if (/^file:\/\//i.test(pathToAdd)) {
      try {
        const fileUrl = new URL(pathToAdd);
        if (fileUrl.hostname && fileUrl.hostname !== 'localhost') throw new Error('Only local file:// paths are supported');
        pathToAdd = decodeURIComponent(fileUrl.pathname);
      } catch {
        rootError = 'Enter a valid local file:// path';
        return;
      }
    }
    const response = await fetch(comfyUrl + '/browser/roots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: pathToAdd }),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      rootError = result.message || 'Could not add directory';
      return;
    }
    const rootsResponse = await fetch(comfyUrl + '/browser/roots');
    const rootsResult = await rootsResponse.json();
    browserRoots = rootsResult.roots || browserRoots;
    newRootPath = '';
    await selectBrowserRoot('outputs');
  }

  async function removeBrowserRoot(rootId: string) {
    syncViewMode();
    if (rootId === 'outputs') return;
    const response = await fetch(comfyUrl + `/browser/roots/${encodeURIComponent(rootId)}`, { method: 'DELETE' });
    if (!response.ok) return;
    browserRoots = browserRoots.filter((root) => root.id !== rootId);
    if (activeRootId === rootId) await selectBrowserRoot('outputs');
  }

  function onRootDragStart(event: DragEvent, rootId: string) {
    if (rootId === 'outputs') {
      event.preventDefault();
      return;
    }
    draggedRootId = rootId;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', rootId);
    }
  }

  function onRootDragOver(event: DragEvent, targetRootId: string) {
    if (!draggedRootId || targetRootId === 'outputs' || targetRootId === draggedRootId) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  async function onRootDrop(event: DragEvent, targetRootId: string) {
    event.preventDefault();
    const sourceRootId = draggedRootId || event.dataTransfer?.getData('text/plain');
    draggedRootId = null;
    if (!sourceRootId || targetRootId === 'outputs' || sourceRootId === targetRootId) return;

    const customRoots = browserRoots.filter((root) => !root.default);
    const fromIndex = customRoots.findIndex((root) => root.id === sourceRootId);
    const toIndex = customRoots.findIndex((root) => root.id === targetRootId);
    if (fromIndex < 0 || toIndex < 0) return;
    customRoots.splice(toIndex, 0, ...customRoots.splice(fromIndex, 1));
    const reorderedRoots = [browserRoots.find((root) => root.default), ...customRoots].filter(Boolean);
    const previousRoots = browserRoots;
    browserRoots = reorderedRoots;
    try {
      const response = await fetch(comfyUrl + '/browser/roots', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root_ids: customRoots.map((root) => root.id) }),
      });
      if (!response.ok) throw new Error('Could not save directory order');
      const result = await response.json();
      browserRoots = result.roots || reorderedRoots;
      rootError = '';
    } catch (error) {
      browserRoots = previousRoots;
      rootError = error instanceof Error ? error.message : 'Could not save directory order';
    }
  }

  function updateFolderHistoryButtons() {
    canGoBack = folderHistoryIndex > 0;
    canGoForward = folderHistoryIndex < folderHistory.length - 1;
  }

  function resetFolderHistory(path = '') {
    folderHistory = [path];
    folderHistoryIndex = 0;
    updateFolderHistoryButtons();
  }

  function navigateToFolder(path: string) {
    if (path === folderPath) return;
    playBrowserSound('navigate');
    syncViewMode();
    selectedFile = null;
    postPreview(null);
    folderHistory = folderHistory.slice(0, folderHistoryIndex + 1);
    folderHistory.push(path);
    folderHistoryIndex = folderHistory.length - 1;
    folderPath = path;
    searchQuery = '';
    candidateQuery = '';
    pathSearchResults = null;
    pathSearchRequestId += 1;
    if (folderType === 'outputs') localStorage.setItem(folderStorageKey(), folderPath);
    updateFolderHistoryButtons();
  }

  function onClickPath(index: number) {
    const nextPath = index < 0 ? '' : currentPathSegments.slice(0, index + 1).join('/');
    navigateToFolder(nextPath);
  }

  function toggleBreadcrumbOrientation() {
    breadcrumbOrientation = breadcrumbOrientation === 'horizontal' ? 'vertical' : 'horizontal';
    localStorage.setItem('comfyui-browser-breadcrumb-orientation', breadcrumbOrientation);
  }

  function goBack() {
    if (!canGoBack) { toast?.invalid(); return; }
    playBrowserSound('navigate');
    syncViewMode();
    folderHistoryIndex -= 1;
    folderPath = folderHistory[folderHistoryIndex];
    if (folderType === 'outputs') localStorage.setItem(folderStorageKey(), folderPath);
    updateFolderHistoryButtons();
  }

  function goForward() {
    if (!canGoForward) { toast?.invalid(); return; }
    playBrowserSound('navigate');
    syncViewMode();
    folderHistoryIndex += 1;
    folderPath = folderHistory[folderHistoryIndex];
    if (folderType === 'outputs') localStorage.setItem(folderStorageKey(), folderPath);
    updateFolderHistoryButtons();
  }

  function onFolderShortcut(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;

    event.preventDefault();
    event.stopPropagation();
    event.key === 'ArrowLeft' ? goBack() : goForward();
  }

  function onFileShortcut(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    if (deleteConfirmFile) {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelDelete();
      }
      return;
    }
    if (!hoveredFile || target?.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const key = event.key.toLowerCase();
    if (!['s', 'l', 'd'].includes(key)) return;
    if (key === 'l' && (!comfyApp || hoveredFile.type === 'dir')) return;

    event.preventDefault();
    event.stopPropagation();
    if (key === 's') void onToggleFavorite(hoveredFile);
    if (key === 'l') void onLoadWorkflow(hoveredFile, comfyApp, toast);
    if (key === 'd') openDeleteConfirm(hoveredFile);
  }

  function onMouseNavigationCapture(event: MouseEvent | PointerEvent) {
    if (event.button !== 3 && event.button !== 4) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === 'pointerdown' || event.type === 'mousedown') {
      mouseNavigationHandled = false;
      return;
    }
    if (event.type === 'pointerup' || event.type === 'mouseup') {
      if (mouseNavigationHandled) return;
      mouseNavigationHandled = true;
      handleMouseNavigation(event.button, event.ctrlKey);
      return;
    }
    if (event.type === 'auxclick') {
      if (!mouseNavigationHandled) handleMouseNavigation(event.button, event.ctrlKey);
      mouseNavigationHandled = false;
    }
  }

  function handleMouseNavigation(button: number, ctrlKey: boolean) {
    if (selectedFile) {
      const previewDirection = button === 3 ? 1 : -1;
      navigatePreview(previewDirection, ctrlKey);
    } else {
      button === 3 ? goBack() : goForward();
    }
  }

  function resetStandalonePreview() {
    standalonePreviewZoom = 1;
    standalonePreviewPanX = 0;
    standalonePreviewPanY = 0;
    stopStandaloneImagePan();
  }

  function zoomStandalonePreview(event: WheelEvent) {
    if (selectedFile?.fileType === 'markdown' && standaloneTextSplit && standaloneMarkdownPages) {
      event.preventDefault();
      const horizontalDelta = event.deltaX || event.deltaY;
      standaloneMarkdownPages.scrollLeft += horizontalDelta;
      updateMarkdownPagePosition();
      return;
    }
    if (selectedFile?.fileType !== 'image') {
      if ((selectedFile?.fileType === 'text' || selectedFile?.fileType === 'json' || selectedFile?.fileType === 'markdown' || selectedFile?.fileType === 'html') && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        changeTextZoom(event.deltaY < 0 ? 0.05 : -0.05);
      }
      return;
    }
    event.preventDefault();
    standalonePreviewZoom = Math.max(0.2, Math.min(6,
      standalonePreviewZoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
  }

  function changeTextZoom(delta: number) {
    standaloneTextZoom = Math.max(0.65, Math.min(2.5, Math.round((standaloneTextZoom + delta) * 100) / 100));
  }

  function updateMarkdownPagePosition() {
    if (!standaloneMarkdownPages) return;
    const pageWidth = standaloneMarkdownPages.clientWidth;
    standaloneMarkdownPageCount = Math.max(1, Math.ceil(standaloneMarkdownPages.scrollWidth / Math.max(pageWidth, 1)));
    standaloneMarkdownPage = Math.min(standaloneMarkdownPageCount, Math.floor(standaloneMarkdownPages.scrollLeft / Math.max(pageWidth, 1)) + 1);
  }

  function turnMarkdownPage(direction: number) {
    if (!standaloneMarkdownPages) return;
    standaloneMarkdownPages.scrollBy({ left: direction * standaloneMarkdownPages.clientWidth, behavior: 'smooth' });
    setTimeout(updateMarkdownPagePosition, 250);
  }

  function resetStandaloneImagePreview(event: MouseEvent) {
    if (selectedFile?.fileType === 'image' && !(event.target as Element).closest('button')) resetStandalonePreview();
  }

  function startStandaloneImagePan(event: PointerEvent) {
    if (selectedFile?.fileType !== 'image' || event.button !== 0 || (event.target as Element).closest('button')) return;
    event.preventDefault();
    standalonePanOrigin = {
      x: event.clientX, y: event.clientY,
      panX: standalonePreviewPanX, panY: standalonePreviewPanY,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function moveStandaloneImagePan(event: PointerEvent) {
    if (!standalonePanOrigin) return;
    standalonePreviewPanX = standalonePanOrigin.panX + event.clientX - standalonePanOrigin.x;
    standalonePreviewPanY = standalonePanOrigin.panY + event.clientY - standalonePanOrigin.y;
  }

  function stopStandaloneImagePan() {
    standalonePanOrigin = null;
  }

  async function onSelectFile(file: any, withSound = true) {
    if (selectedFile && selectedFile.name === file.name && selectedFile.folder_path === file.folder_path && selectedFile.root_id === activeRootId) {
      selectedFile = null;
      if (withSound) playBrowserSound('action');
      postPreview(null);
      return;
    }
    if (withSound) playBrowserSound('action');
    selectedFile = file;
    standaloneTextZoom = 1;
    standaloneTextSplit = false;
    standaloneMarkdownPage = 1;
    standaloneMarkdownPageCount = 1;
    if (standaloneBrowser) {
      resetStandalonePreview();
      standalonePreviewText = '';
      if (file.fileType === 'text' || file.fileType === 'html' || file.fileType === 'json' || file.fileType === 'markdown') {
        try {
          const response = await fetch(file.url);
          standalonePreviewText = response.ok ? await response.text() : `Could not load preview: HTTP ${response.status}`;
        } catch (error) {
          standalonePreviewText = `Could not load preview: ${error}`;
        }
      }
    } else {
      postPreview({
        name: file.name,
        fileType: file.fileType,
        url: file.url,
        previewUrl: file.previewUrl || file.url,
        formattedSize: file.formattedSize,
        rootId: activeRootId,
      });
    }
  }

  function postPreview(file: any) {
    if (window.top !== window) {
      window.top?.postMessage({ source: 'comfyui-browser', type: 'preview', file, mode: viewMode, position: file ? getPreviewPosition(file) : null }, '*');
    }
  }

  async function onToggleFavorite(file: any) {
    const key = JSON.stringify([activeRootId, file.folder_path || '', file.name]);
    if (favoriteBusyKey === key) return;
    const nextValue = !file.is_favorite;
    favoriteBusyKey = key;
    try {
      const res = await fetch(comfyUrl + '/browser/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          folder_path: file.folder_path,
          folder_type: folderType,
          root_id: activeRootId,
          favorite: nextValue,
        }),
      });
      if (res.ok) {
        file.is_favorite = nextValue;
        files = [...files];
        playBrowserSound('action');
      }
      toast.show(res.ok, nextValue ? 'Added to Saves' : 'Removed from Saves', 'Failed to update Saves');
    } catch (error) {
      console.error('Failed to update Saves', error);
      toast.show(false, nextValue ? 'Added to Saves' : 'Removed from Saves', 'Failed to update Saves');
    } finally {
      favoriteBusyKey = '';
    }
  }

  async function scrollToTop() {
    window.scrollTo(0, 0);
  }


  function openDeleteConfirm(file: any) {
    if (!file) return;
    deleteConfirmFile = file;
    positionDeleteHint(pointerX, pointerY);
  }

  function positionDeleteHint(x: number, y: number) {
    deleteHintX = Math.max(8, Math.min(window.innerWidth - 336, x + 16));
    deleteHintY = Math.max(8, Math.min(window.innerHeight - 340, y + 16));
  }

  function onGlobalPointerMove(event: PointerEvent) {
    pointerX = event.clientX;
    pointerY = event.clientY;
  }

  function cancelDelete() {
    deleteConfirmFile = null;
  }

  async function confirmDelete() {
    const file = deleteConfirmFile;
    if (!file) return;
    cancelDelete();
    const res = await fetch(comfyUrl + '/browser/files', {
      method: 'DELETE',
      body: JSON.stringify({
        folder_type: folderType,
        root_id: activeRootId,
        filename: file.name,
        folder_path: file.folder_path,
      }),
    });

    refresh();
    if (res.ok) playBrowserSound('action');
    toast.show(
      res.ok,
      tt('Deleted the file') + file.name,
      tt('Failed to delete the file'),
    );
  }

  function trackFileHover(file: any, event: PointerEvent) {
    hoveredFile = file;
    pointerX = event.clientX;
    pointerY = event.clientY;
  }

  async function onClickDir(dir: any) {
    searchQuery = '';
    candidateQuery = '';
    pathSearchResults = null;
    const canonicalPath = [dir.folder_path, dir.name].filter(Boolean).join('/');
    navigateToFolder(canonicalPath || dir.path || '');
  }

  function onClickCard(file: any, event: MouseEvent) {
    const target = event.target as HTMLElement | null;
    if (target?.closest('button')) return;
    if (file.type === 'dir') void onClickDir(file);
    else void onSelectFile(file);
  }

  function onDoubleClickCard(file: any, event: MouseEvent) {
    const target = event.target as HTMLElement | null;
    if (file.fileType !== 'html' || !target?.closest('[data-file-preview-target]')) return;
    event.preventDefault();
    event.stopPropagation();
    window.open(file.url, '_blank', 'noopener,noreferrer');
  }

  function onCardKeydown(file: any, event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onClickCard(file, event as unknown as MouseEvent);
  }

</script>

<div class="relative z-30 ml-3 mt-2 flex min-w-0 flex-nowrap items-center gap-1 text-sm">
  <div class="flex shrink-0 items-center gap-1">
    <div class="flex shrink-0 items-center gap-0.5">
      <button class="btn btn-ghost btn-sm px-1" aria-label="Back" title="Back (Alt+←)" aria-disabled={!canGoBack} on:click={goBack}>
        <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 18l-6-6 6-6" /></svg>
      </button>
      <button class="btn btn-ghost btn-sm px-1" aria-label="Forward" title="Forward (Alt+→)" aria-disabled={!canGoForward} on:click={goForward}>
        <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 18l6-6-6-6" /></svg>
      </button>
    </div>
  </div>
  <div class="min-w-0 flex-1" aria-hidden="true"></div>

  <div class="relative flex w-48 shrink-0 items-center">
    <input
      type="text"
      placeholder={tt('searchInput.placeholder')}
      bind:this={searchInput}
      bind:value={searchQuery}
      on:input={onSearchInput}
      on:keydown={onSearchKeydown}
      on:focus={() => { if (searchQuery.trim()) showSearchCandidates = true; }}
      class="input input-bordered input-sm min-w-0 flex-1 border-slate-600 text-sm"
    />
    {#if showSearchCandidates && searchCandidates.length > 0}
      <div class="absolute left-0 right-0 top-full mt-1 max-h-64 overflow-auto rounded-md border border-base-content/20 bg-base-200 shadow-xl">
        {#each searchCandidates as candidate}
          <button class="block w-full truncate px-3 py-2 text-left text-sm hover:bg-base-300 {selectedSearchCandidate === searchCandidatePath(candidate) ? 'bg-base-300' : ''}" title={searchCandidatePath(candidate)} on:click={() => selectSearchCandidate(candidate)}>
            {searchCandidatePath(candidate)}
          </button>
        {/each}
      </div>
    {/if}
  </div>
  <label class="flex shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap text-xs" title="显示或隐藏 . 开头的文件夹">
    <input type="checkbox" class="checkbox checkbox-xs" checked={showHiddenDirectories} on:change={toggleShowHiddenDirectories} />
    显示 . 文件夹
  </label>
  <div class="flex shrink-0 items-center gap-0.5" aria-label="Date filter">
    <button class="btn btn-xs px-2 {datePreset === 'today' ? 'btn-active' : 'btn-ghost'}" aria-pressed={datePreset === 'today'} on:click={() => setDatePreset('today')}>今日</button>
    <button class="btn btn-xs px-2 {datePreset === '3days' ? 'btn-active' : 'btn-ghost'}" aria-pressed={datePreset === '3days'} on:click={() => setDatePreset('3days')}>3 日</button>
    <button class="btn btn-xs px-2 {datePreset === 'week' ? 'btn-active' : 'btn-ghost'}" aria-pressed={datePreset === 'week'} on:click={() => setDatePreset('week')}>一周</button>
  </div>
  <div class="flex shrink-0 items-center gap-0.5" aria-label="File sorting">
    <select class="select select-bordered select-xs w-[4.5rem] px-1" aria-label="Sort files by" value={sortBy} on:change={onSortChange}>
      <option value="time">时间</option>
      <option value="name">名字</option>
      <option value="size">大小</option>
    </select>
    <button class="btn btn-ghost btn-xs btn-square h-7 min-h-0 w-7" aria-label={sortDirection === 'desc' ? 'Descending order' : 'Ascending order'} title={sortDirection === 'desc' ? 'Descending' : 'Ascending'} on:click={toggleSortDirection}>{sortDirection === 'desc' ? '↓' : '↑'}</button>
  </div>
  <button class="btn btn-ghost btn-sm btn-square shrink-0" aria-label={viewMode === 'side' ? 'Switch to full view' : 'Switch to side view'} title={viewMode === 'side' ? 'Full view' : 'Side view'} on:click={toggleHostViewMode}>
    {#if viewMode === 'side'}
      <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3" /></svg>
    {:else}
      <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2" /><path stroke-linecap="round" d="M9 4v16" /></svg>
    {/if}
  </button>
  <button class="btn btn-ghost btn-sm btn-square shrink-0" aria-label="Open in new tab" title="Open in new tab" on:click={() => window.open(window.location.href, '_blank', 'noopener')}>
    <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H19v5.5M19 6l-8 8" /><path stroke-linecap="round" stroke-linejoin="round" d="M19 13v4.25A1.75 1.75 0 0 1 17.25 19h-10.5A1.75 1.75 0 0 1 5 17.25V6.75A1.75 1.75 0 0 1 6.75 5H11" /></svg>
  </button>

{#if folderType === 'outputs'}
  <div class="fixed left-14 top-14 z-[45] h-fit w-max max-h-[45vh] max-w-none rounded-md border border-white/15 bg-black/80 p-2 pr-8 text-xs leading-tight text-white shadow-xl backdrop-blur-sm">
    <nav class="flex max-h-[calc(45vh-1rem)] items-center gap-1 overflow-auto {breadcrumbOrientation === 'vertical' ? 'flex-col items-start' : 'flex-row whitespace-nowrap'}" aria-label="Current directory breadcrumb">
      <button class="whitespace-nowrap py-0.5 text-left font-semibold hover:underline" title={activeRoot?.name || 'Root'} on:click={() => onClickPath(-1)}>{activeRoot?.name || 'Root'}</button>
      {#each currentPathSegments as segment, index}
        <span class="shrink-0 opacity-60" aria-hidden="true">{breadcrumbOrientation === 'vertical' ? '↓' : '›'}</span>
        <button class="whitespace-nowrap py-0.5 text-left hover:underline" title={segment} on:click={() => onClickPath(index)}>{segment}</button>
      {/each}
    </nav>
    <button class="btn btn-ghost btn-xs btn-square absolute right-0.5 top-0.5 h-6 min-h-0 w-6" aria-label={breadcrumbOrientation === 'horizontal' ? 'Switch breadcrumb to vertical' : 'Switch breadcrumb to horizontal'} title={breadcrumbOrientation === 'horizontal' ? 'Vertical breadcrumb' : 'Horizontal breadcrumb'} on:click={toggleBreadcrumbOrientation}>
      {#if breadcrumbOrientation === 'horizontal'}
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" d="M5 7h14M5 12h14M5 17h14" /></svg>
      {:else}
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" d="M7 5v14M12 5v14M17 5v14" /></svg>
      {/if}
    </button>
  </div>
{/if}

{#if folderType === 'outputs' && rootSettingsOpen}
  <button class="fixed inset-0 z-40 cursor-default bg-transparent" aria-label="Close directory settings" on:click={() => { rootSettingsOpen = false; }}></button>
{/if}
{#if folderType === 'outputs'}
  <div class="relative z-50 shrink-0">
    <button class="btn btn-circle btn-sm shadow-lg" aria-label="Directory settings" title="Directory settings" on:click={toggleRootSettings}>
      {#if rootSettingsOpen}
        <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M18 6L6 18" /></svg>
      {:else}
        <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M3 7.5A1.5 1.5 0 014.5 6h5l2 2H19.5A1.5 1.5 0 0121 9.5v8a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 17.5v-10z" /></svg>
      {/if}
    </button>
    {#if rootSettingsOpen}
      <section class="absolute right-0 top-full z-50 mt-2 flex h-[min(72vh,38rem)] w-[min(92vw,28rem)] flex-col overflow-hidden rounded-lg border border-base-content/20 bg-base-200/95 p-3 shadow-2xl backdrop-blur" aria-label="Directory settings">
        <p class="px-1 text-xs opacity-70">Add a directory here, then choose it from the browser root to switch.</p>
        <div class="mt-3 flex min-h-0 flex-1 flex-col rounded border border-base-content/15 p-2">
          <div class="mb-2 flex items-center gap-2">
            <input
              bind:value={newRootPath}
              class="input input-bordered input-sm min-w-0 flex-1 text-xs"
              placeholder="Absolute path or file:///..."
              aria-label="Directory path to add"
              on:keydown={(event) => { if (event.key === 'Enter' && newRootPath.trim()) addBrowserRoot(); }}
            />
            <button class="btn btn-primary btn-xs" disabled={!newRootPath.trim()} on:click={addBrowserRoot}>Add path</button>
          </div>
          <div class="mb-2 flex items-center gap-2">
            <button class="btn btn-ghost btn-xs" disabled={!pickerParent || pickerLoading} on:click={() => pickerParent && loadPickerDirectory(pickerParent)}>Up</button>
            <button class="min-w-0 flex-1 truncate text-left text-xs hover:underline" title={`Click to copy: ${pickerPath}`} on:click={() => copyDirectoryPath(pickerPath)}>{pickerPath || 'Loading…'}</button>
            <button class="btn btn-primary btn-xs" disabled={!pickerPath || pickerLoading || browserRoots.some((root) => root.path === pickerPath)} on:click={async () => { newRootPath = pickerPath; await addBrowserRoot(); }}>Add this folder</button>
          </div>
          {#if pickerError}<p class="mb-2 text-xs text-error">{pickerError}</p>{/if}
          {#if pickerNotice}<p class="mb-2 truncate text-xs text-success" title={pickerNotice}>{pickerNotice}</p>{/if}
          <div class="min-h-0 flex-1 overflow-auto">
            {#if pickerLoading}
              <p class="p-2 text-xs opacity-60">Loading folders…</p>
            {:else if pickerDirectories.length === 0}
              <p class="p-2 text-xs opacity-60">No subfolders</p>
            {:else}
              {#each pickerDirectories as directory}
                <div class="flex items-center gap-1 rounded hover:bg-base-300">
                  <button class="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm" title={`Open ${directory.path} and copy its path`} on:click={() => selectPickerDirectory(directory.path)}>
                    <span class="truncate">{directory.name}</span>
                  </button>
                  <button class="btn btn-ghost btn-xs" aria-label={`Copy path for ${directory.name}`} title="Copy full path" on:click={() => copyDirectoryPath(directory.path)}>
                    <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="8" y="8" width="12" height="12" rx="2"/><path stroke-linecap="round" stroke-linejoin="round" d="M16 8V5.75A1.75 1.75 0 0 0 14.25 4h-8.5A1.75 1.75 0 0 0 4 5.75v8.5A1.75 1.75 0 0 0 5.75 16H8"/></svg>
                  </button>
                  <button class="btn btn-ghost btn-xs" aria-label={`Open ${directory.name}`} title="Open folder" on:click={() => loadPickerDirectory(directory.path)}>
                    <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m9 5 7 7-7 7" /></svg>
                  </button>
                </div>
              {/each}
            {/if}
          </div>
        </div>
        {#if rootError}<p class="mt-2 text-xs text-error">{rootError}</p>{/if}
      </section>
    {/if}
  </div>
{/if}
</div>

{#if folderType === 'outputs' && !folderPath}
  <nav class="mx-3 my-2 flex flex-wrap gap-2" aria-label="Browser directories">
    {#each browserRoots as root}
      <div
        class="flex max-w-full items-center rounded-lg border {root.id === activeRootId ? 'border-primary bg-primary/10' : 'border-base-content/20 bg-base-200'} {draggedRootId === root.id ? 'opacity-50' : ''}"
        role="group"
        aria-label={`Directory ${root.name}`}
        draggable={!root.default}
        on:dragstart={(event) => onRootDragStart(event, root.id)}
        on:dragover={(event) => onRootDragOver(event, root.id)}
        on:drop={(event) => onRootDrop(event, root.id)}
        on:dragend={() => { draggedRootId = null; }}
      >
        {#if !root.default}<span class="cursor-grab select-none px-1 opacity-40" aria-hidden="true" title="Drag to reorder">⠿</span>{/if}
        <button class="flex min-w-0 flex-col px-3 py-2 text-left" title={root.path} on:click={() => selectBrowserRoot(root.id)}>
          <span class="font-semibold">{root.name}</span>
          <span class="max-w-[min(70vw,32rem)] truncate text-xs opacity-65">{root.path}</span>
        </button>
        {#if !root.default}
          <button class="btn btn-ghost btn-xs mr-1 text-error" aria-label={`Remove ${root.name}`} title="Remove this directory" on:click={() => removeBrowserRoot(root.id)}>✕</button>
        {/if}
      </div>
    {/each}
  </nav>
{/if}

<div class="grid w-full gap-2" style="grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr));">
  {#each sortedFiles.slice(0, showCursor) as file}
    {#if WHITE_EXTS.includes(file.fileType)}
    <div data-preview-file={file.name} data-preview-folder={file.folder_path} class="group relative flex h-full flex-col overflow-hidden rounded-lg bg-black transition-shadow {selectedFile?.name === file.name && selectedFile?.folder_path === file.folder_path ? 'ring-2 ring-sky-300 shadow-[0_0_24px_6px_rgba(56,189,248,.75)]' : ''} {deleteConfirmFile === file ? 'ring-2 ring-red-500 shadow-[0_0_26px_6px_rgba(239,68,68,.9)]' : ''}" role="button" tabindex="0" on:click={(event) => onClickCard(file, event)} on:dblclick={(event) => onDoubleClickCard(file, event)} on:keydown={(event) => onCardKeydown(file, event)} on:pointerenter={(event) => trackFileHover(file, event)} on:pointermove={(event) => trackFileHover(file, event)} on:pointerleave={() => { if (hoveredFile === file) hoveredFile = null; }}>
        <MediaShow {file} styleClass="w-full min-h-24 flex-auto" {onClickDir} {onSelectFile} />

        <button
          class="btn btn-circle btn-ghost btn-xs absolute left-1 top-1 z-10 h-7 min-h-0 w-7 p-0 shadow backdrop-blur-sm hover:bg-black/50 {favoriteBusyKey === JSON.stringify([activeRootId, file.folder_path || '', file.name]) ? 'animate-pulse bg-black/70 text-sky-300' : file.is_favorite ? 'bg-black/50 text-yellow-300' : 'bg-black/35 text-white'}"
          disabled={favoriteBusyKey === JSON.stringify([activeRootId, file.folder_path || '', file.name])}
          aria-pressed={!!file.is_favorite}
          aria-label={file.is_favorite ? 'Remove from Saves' : 'Add to Saves'}
          title={`${file.is_favorite ? 'Remove from Saves' : 'Add to Saves'} (S)`}
          on:click={async () => await onToggleFavorite(file)}
        >
          <svg class="h-[18px] w-[18px]" viewBox="0 0 24 24" fill={file.is_favorite ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3z"/></svg>
        </button>
        {#if ['text', 'markdown', 'json'].includes(file.fileType)}
          <div class="pointer-events-none absolute left-1/2 top-1 z-[1] w-fit max-w-[calc(100%_-_3rem)] -translate-x-1/2 truncate rounded bg-black/70 px-2 py-1 text-center text-xs font-semibold text-white" title={file.name}>{file.name}</div>
        {:else if file.type === 'dir'}
          <div class="pointer-events-none absolute left-1 right-1 top-1/2 z-[1] max-h-[calc(100%_-_3rem)] -translate-y-1/2 overflow-hidden text-center opacity-80">
            <div class="mx-auto grid max-h-[calc(100%_-_3rem)] w-full grid-cols-2 gap-1 font-bold leading-[1.3] text-[28px]" title={file.name}>
              {#each filenameColumns(file.name, false) as column, index}
                <p class="min-w-0 overflow-hidden {index === 0 ? 'text-left' : 'text-right'}">{#each column as part}<span class="block w-fit max-w-full break-words bg-black/70 px-[0.12em] {index === 1 ? 'ml-auto' : ''}" style={`color:${part.color}`}>{part.text}</span>{/each}</p>
              {/each}
            </div>
          </div>
        {:else}
          <div class="pointer-events-none absolute left-1 right-1 top-1/2 z-[1] max-h-[calc(100%_-_3rem)] -translate-y-1/2 overflow-hidden opacity-80">
            <div class="mx-auto grid max-h-[calc(100%_-_3rem)] w-full grid-cols-2 gap-1 font-bold leading-[1.3] text-[28px]" title={file.name}>
              {#each filenameColumns(file.name, true) as column, index}
                <p class="min-w-0 overflow-hidden {index === 0 ? 'text-left' : 'text-right'}">{#each column as part}<span class="block w-fit max-w-full break-words bg-black/70 px-[0.12em] {index === 1 ? 'ml-auto' : ''}" style={`color:${part.color}`}>{part.text}</span>{/each}</p>
              {/each}
            </div>
          </div>
        {/if}
        <div class="pointer-events-none absolute bottom-1 left-1 max-w-[calc(50%-0.35rem)] truncate rounded-md border border-white/15 bg-black/80 px-2 py-1 text-xs leading-4 shadow backdrop-blur-[3px]" style={`color:${dateColor(file.created_at)}`} title={`${file.formattedDatetime} · ${file.formattedSize}`}>
          <span>{file.formattedDatetime.split(' ')[0].slice(5)}</span>
          <span class="ml-1">{file.formattedDatetime.split(' ')[1].slice(0, 5)}</span>
        </div>
        <div class="pointer-events-none absolute bottom-1 right-1 max-w-[calc(50%-0.35rem)] truncate rounded-md border border-white/15 bg-black/80 px-2 py-1 text-xs font-semibold leading-4 shadow backdrop-blur-[3px]" style={`color:${sizeColor(file.bytes || 0)}`} title={file.formattedSize}>
          {file.formattedSize}
        </div>
      </div>
    {/if}
  {/each}
</div>
<DeleteTargetHint file={deleteConfirmFile} x={deleteHintX} y={deleteHintY} onConfirm={confirmDelete} onCancel={cancelDelete} />


<div class="flex justify-center">
  {#if sortedFiles.length > showCursor}
    <button on:click={() => showCursor += 10} class="btn btn-neutral btn-outline">Load more</button>
  {:else}
    <p class="text-neutral-content">No more content.</p>
  {/if}
</div>

<svelte:window on:blur={stopStandaloneImagePan} />

{#if standaloneBrowser && selectedFile}
  <button class="fixed inset-0 z-40 bg-black/20 cursor-default" aria-label="Close preview" title="Click outside to close" on:click={() => selectedFile = null}></button>
  <section class="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[88vw] h-[86vh] rounded-lg border border-base-content/30 bg-base-200/90 shadow-2xl backdrop-blur-sm p-3 flex flex-col" role="dialog" aria-modal="true" aria-label={selectedFile.name}>
    <div class="flex items-center gap-2 mb-2">
      <strong class="truncate flex-1">{selectedFile.name}</strong>
      <span class="text-xs opacity-70">{selectedFile.formattedSize}</span>
      {#if ['text', 'html', 'json', 'markdown'].includes(selectedFile.fileType)}
        <div class="flex items-center gap-1 rounded bg-base-300/70 px-1">
          <button class="btn btn-ghost btn-xs" aria-label="Decrease text size" title="Decrease text size (−)" on:click={() => changeTextZoom(-0.1)}>−</button>
          <span class="min-w-10 text-center text-xs tabular-nums">{Math.round(standaloneTextZoom * 100)}%</span>
          <button class="btn btn-ghost btn-xs" aria-label="Increase text size" title="Increase text size (+)" on:click={() => changeTextZoom(0.1)}>+</button>
          <button class="btn btn-ghost btn-xs" title="Reset text size (0)" on:click={() => standaloneTextZoom = 1}>↺</button>
        </div>
        {#if selectedFile.fileType === 'markdown'}
          <button class="btn btn-outline btn-xs" aria-pressed={standaloneTextSplit} title="Toggle paged two-column Markdown view" on:click={() => { standaloneTextSplit = !standaloneTextSplit; standaloneMarkdownPage = 1; requestAnimationFrame(updateMarkdownPagePosition); }}>{standaloneTextSplit ? '单栏' : '双栏分页'}</button>
          {#if standaloneTextSplit}
            <button class="btn btn-ghost btn-xs" aria-label="Previous Markdown spread" disabled={standaloneMarkdownPage <= 1} on:click={() => turnMarkdownPage(-1)}>‹</button>
            <span class="min-w-12 text-center text-xs tabular-nums">{standaloneMarkdownPage}/{standaloneMarkdownPageCount}</span>
            <button class="btn btn-ghost btn-xs" aria-label="Next Markdown spread" disabled={standaloneMarkdownPage >= standaloneMarkdownPageCount} on:click={() => turnMarkdownPage(1)}>›</button>
          {/if}
        {/if}
      {/if}
      <button class="btn btn-ghost btn-sm" aria-label="Close preview" on:click={() => selectedFile = null}>✕</button>
    </div>
    <div
      class="relative min-h-0 flex-1 flex items-center justify-center overflow-hidden"
      role="presentation"
      style:touch-action={selectedFile.fileType === 'image' ? 'none' : 'auto'}
      on:wheel|nonpassive={zoomStandalonePreview}
      on:dblclick={resetStandaloneImagePreview}
      on:pointerdown={startStandaloneImagePan}
      on:pointermove={moveStandaloneImagePan}
      on:pointerup={stopStandaloneImagePan}
      on:pointercancel={stopStandaloneImagePan}
      on:lostpointercapture={stopStandaloneImagePan}
    >
      {#if selectedFile.fileType === 'image'}
        <img
          class="max-w-full max-h-full object-contain select-none"
          src={selectedFile.previewUrl}
          alt={selectedFile.name}
          draggable="false"
          style:transform={`translate(${standalonePreviewPanX}px, ${standalonePreviewPanY}px) scale(${standalonePreviewZoom})`}
          style:cursor={standalonePanOrigin ? 'grabbing' : 'grab'}
        />
      {:else if selectedFile.fileType === 'video'}
        <video class="max-w-full max-h-full" src={selectedFile.previewUrl} controls playsinline><track kind="captions" /></video>
      {:else if selectedFile.fileType === 'audio'}
        <audio class="w-full max-w-2xl" src={selectedFile.url} controls />
      {:else}
        <div class="h-full w-full overflow-auto rounded bg-base-100/80 p-4" style:font-size={`${standaloneTextZoom}em`}>
          {#if selectedFile.fileType === 'markdown' && standaloneTextSplit}
            <div bind:this={standaloneMarkdownPages} class="comfy-browser-markdown h-full w-full overflow-x-auto overflow-y-hidden" style="column-count: 2; column-gap: 2rem; column-fill: auto; font-size: {14 * standaloneTextZoom}px;" on:scroll={updateMarkdownPagePosition}>
              {@html standalonePreviewHtml}
            </div>
          {:else if selectedFile.fileType === 'markdown'}
            <div class="comfy-browser-markdown mx-auto h-full max-w-5xl" style="font-size: {14 * standaloneTextZoom}px">{@html standalonePreviewHtml}</div>
          {:else}
            <pre class="mx-auto h-full max-w-5xl overflow-auto whitespace-pre-wrap break-words rounded border border-base-content/10 bg-base-200/40 p-4 font-mono text-[0.85em] leading-relaxed">{selectedFile.fileType === 'json' ? standalonePrettyJson : standalonePreviewText}</pre>
          {/if}
        </div>
      {/if}
      <button
        class="absolute left-3 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-white/50 bg-black/70 p-0 text-white [box-shadow:0_2px_10px_rgba(0,0,0,.45)] transition-transform duration-100 active:scale-90 {standalonePreviewPosition.index <= 1 ? 'cursor-not-allowed border-white/20 bg-neutral-500/60 text-white/50 opacity-50' : ''}"
        aria-label="Previous preview"
        title="Previous preview (←)"
        aria-disabled={standalonePreviewPosition.index <= 1}
        on:click|stopPropagation={() => navigatePreview(-1)}
      ><svg viewBox="0 0 24 24" aria-hidden="true" class="h-[22px] w-[22px]"><path d="m15 5-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" /></svg></button>
      <button
        class="absolute right-3 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-white/50 bg-black/70 p-0 text-white [box-shadow:0_2px_10px_rgba(0,0,0,.45)] transition-transform duration-100 active:scale-90 {standalonePreviewPosition.index >= standalonePreviewPosition.total ? 'cursor-not-allowed border-white/20 bg-neutral-500/60 text-white/50 opacity-50' : ''}"
        aria-label="Next preview"
        title="Next preview (→)"
        aria-disabled={standalonePreviewPosition.index >= standalonePreviewPosition.total}
        on:click|stopPropagation={() => navigatePreview(1)}
      ><svg viewBox="0 0 24 24" aria-hidden="true" class="h-[22px] w-[22px]"><path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" /></svg></button>
    </div>
    <div class="flex h-10 shrink-0 items-center justify-center text-xs tabular-nums text-white/75" aria-live="polite">{standalonePreviewPosition.index}/{standalonePreviewPosition.total}</div>
  </section>
{/if}

{#if files.length === 0}
  <div class="w-full h-full flex items-center justify-center">
    <span class="font-bold text-4xl">
      {#if loaded}
        {$t('common.emptyList')}
      {:else}
        {$t('common.loading')}
      {/if}
    </span>
  </div>
{/if}

{#if scrollTop >= 300}
<button class="fixed right-10 bottom-10 w-10 h-10 flex justify-center items-center	rounded-full bg-slate-50" on:click={scrollToTop}>
  <svg class="w-5 h-5 icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
    <path fill="#333333" d="M572.235 205.282v600.365a30.118 30.118 0 11-60.235 0V205.282L292.382 438.633a28.913 28.913 0 01-42.646 0 33.43 33.43 0 010-45.236l271.058-288.045a28.913 28.913 0 0142.647 0L834.5 393.397a33.43 33.43 0 010 45.176 28.913 28.913 0 01-42.647 0l-219.618-233.23z"/>
  </svg>
</button>
{/if}
