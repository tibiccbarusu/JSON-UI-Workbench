/*
  Minimal app state store (S016)

  Goals:
  - Plain JS (no framework)
  - Deterministic state updates via action dispatch
  - Subscribe mechanism for UI updates
  - No undo/redo (policy UNDO_REDO_POLICY=NONE)

  Notes:
  - This module defines a *minimal* state shape and action set.
  - Later steps (S025+) will expand project/file models.
*/

import { createEventBus } from './event-bus.js';
import { updateNavigationHistory, setNavigationMapping, removeNavigationMapping } from '../preview/screen-navigation.js';

export const ACTION_TYPES = {
  SET_ROUTE: 'ui/setRoute',
  TOGGLE_DEBUG: 'ui/toggleDebug',

  SET_PANEL_SIZES: 'ui/setPanelSizes',
  SET_EDITOR_TAB: 'ui/setEditorTab',
  SET_PREVIEW_LOCALE: 'ui/setPreviewLocale',
  SET_PREVIEW_FONT_PROFILE: 'ui/setPreviewFontProfile',

  SET_MOCK_DATA: 'preview/setMockData',

  SET_PREVIEW_NAV_ENABLED: 'preview/setNavEnabled',
  NAV_RESET: 'preview/navReset',
  NAV_PUSH: 'preview/navPush',
  NAV_SET_INDEX: 'preview/navSetIndex',
  NAV_SET_ACTION_MAPPING: 'preview/navSetActionMapping',
  NAV_REMOVE_ACTION_MAPPING: 'preview/navRemoveActionMapping',
  NAV_CLEAR_ACTION_MAPPINGS: 'preview/navClearActionMappings',
  NAV_COMMIT: 'preview/navCommit',

  SET_PROJECT: 'project/setProject',

  PACK_IMPORT_START: 'pack/importStart',
  PACK_IMPORT_SUCCESS: 'pack/importSuccess',
  PACK_IMPORT_ERROR: 'pack/importError',
  PACK_UNLOAD: 'pack/unload',

  OPEN_FILE: 'files/openFile',
  CLOSE_FILE: 'files/closeFile',
  SET_CURRENT_FILE: 'files/setCurrentFile',
  PATCH_FILE: 'files/patchFile',
  PATCH_FILES: 'files/patchFiles',

  SELECT_NODE: 'editor/selectNode',
  CLEAR_SELECTION: 'editor/clearSelection',
  UPDATE_PROPERTY: 'editor/updateProperty',
};

/**
 * @typedef {{ id: string, name: string, loadedAtIso: string }} ProjectMeta
 */

/**
 * @typedef {{
 *  id: string,
 *  fileName: string,
 *  zipBytes: number,
 *  importedAtIso: string,
 *  rootPrefix: string,
 *  manifestZipPath: string,
 *  manifestSummary: any,
 *  fileIndex: any,
 *  warnings: { code: string, message: string }[],
 * }} ImportedPack
 */

/**
 * @typedef {{
 *  status: 'idle'|'loading'|'ready'|'error',
 *  errorMessage: string|null,
 *  imported: ImportedPack|null,
 * }} PackState
 */

/**
 * Minimal node model used only for S016 scaffolding.
 * Later steps replace this with the formal UI model (S029+).
 *
 * @typedef {{
 *  id: string,
 *  type: string,
 *  props: Record<string, string|number|boolean|null>,
 *  children: string[],
 * }} StubUiNode
 */

/**
 * @typedef {{
 *  id: string,
 *  path: string,
 *  kind: 'screen'|'system'|'unknown',
 *  dirty: boolean,
 *  rootId: string,
 *  nodesById: Record<string, StubUiNode>,
 * }} OpenFile
 */

/**
 * @typedef {{
 *  project: ProjectMeta|null,
 *  pack: PackState,
 *  files: {
 *    openFileIds: string[],
 *    currentFileId: string|null,
 *    byId: Record<string, OpenFile>,
 *  },
 *  editor: {
 *    selection: { nodeId: string|null },
 *  },
 *  ui: {
 *    route: 'editor'|'about'|string,
 *    debug: boolean,
 *    panels: {
 *      leftPx: number,
 *      rightPx: number,
 *    },
 *    previewLocale: string,
 *    tabs: {
 *      center: string,
 *      right: string,
 *    },
 *  },
 *  preview: {
 *    mockData: Record<string, any>,
 *    mockDataVersion: number,
 *    navigation: {
 *      enabled: boolean,
 *      stack: string[],
 *      index: number,
 *      actionMap: Record<string, string>,
 *    },
 *  },
 * }} AppState
 */

/**
 * @returns {AppState}
 */
export function createInitialState() {
  return {
    project: null,
    pack: {
      status: 'idle',
      errorMessage: null,
      imported: null,
    },
    files: {
      openFileIds: [],
      currentFileId: null,
      byId: {},
    },
    editor: {
      selection: { nodeId: null },
    },
    ui: {
      route: 'editor',
      debug: true,
      panels: {
        // Give project loading and the UI tree enough room to remain readable.
        leftPx: 360,
        // Keep the empty inspector out of the initial workspace. A visible
        // button in the preview toolbar opens it when it is needed.
        rightPx: 0,
      },
      // Preview language for resolving texts/*.lang keys.
      previewLocale: 'en_US',
      previewFontProfile: 'bitmap',
      tabs: {
        // NOTE: The project's current "preview" is provided via the Canvas renderer.
        // Default to the Canvas tab so new sessions open on the working preview.
        center: 'canvas',
        right: 'properties',
      },
    },
    preview: {
      mockData: {
        "#example_visible": true,
      },
      mockDataVersion: 0,
      navigation: {
        enabled: false,
        stack: [],
        index: -1,
        actionMap: {},
      },
    },
  };
}

/**
 * @param {AppState} state
 * @param {{type: string, [k: string]: any}} action
 * @returns {AppState}
 */
export function appReducer(state, action) {
  switch (action.type) {
    case ACTION_TYPES.SET_ROUTE: {
      if (state.ui.route === action.route) return state;
      return {
        ...state,
        ui: {
          ...state.ui,
          route: action.route,
        },
      };
    }

    case ACTION_TYPES.TOGGLE_DEBUG: {
      return {
        ...state,
        ui: {
          ...state.ui,
          debug: !state.ui.debug,
        },
      };
    }

    case ACTION_TYPES.SET_PANEL_SIZES: {
      const leftPx = Number(action.leftPx);
      const rightPx = Number(action.rightPx);
      if (!Number.isFinite(leftPx) || !Number.isFinite(rightPx)) return state;
      if (leftPx === state.ui.panels.leftPx && rightPx === state.ui.panels.rightPx)
        return state;

      return {
        ...state,
        ui: {
          ...state.ui,
          panels: {
            leftPx,
            rightPx,
          },
        },
      };
    }

    case ACTION_TYPES.SET_EDITOR_TAB: {
      const area = String(action.area || '');
      const tabId = String(action.tabId || '');
      if (!area || !tabId) return state;
      if (!['center', 'right'].includes(area)) return state;
      if (state.ui.tabs[area] === tabId) return state;

      return {
        ...state,
        ui: {
          ...state.ui,
          tabs: {
            ...state.ui.tabs,
            [area]: tabId,
          },
        },
      };
    }

    case ACTION_TYPES.SET_MOCK_DATA: {
      const next = (action && action.mockData && typeof action.mockData === 'object') ? action.mockData : {};
      return {
        ...state,
        preview: {
          ...state.preview,
          mockData: next,
          mockDataVersion: (state.preview?.mockDataVersion || 0) + 1,
        },
      };
    }

    // S046: Screen navigation simulator state (screen history stack + action mapping).
    case ACTION_TYPES.SET_PREVIEW_NAV_ENABLED: {
      const enabled = Boolean(action.enabled);
      const current = Boolean(state.preview?.navigation?.enabled);
      if (current === enabled) return state;
      return {
        ...state,
        preview: {
          ...state.preview,
          navigation: {
            ...(state.preview?.navigation || { enabled: false, stack: [], index: -1, actionMap: {} }),
            enabled,
          },
        },
      };
    }

    case ACTION_TYPES.NAV_RESET: {
      let navigation;
      try { navigation = updateNavigationHistory(state.preview?.navigation, action.screenRef || action.fileId, 'reset'); }
      catch { return state; }
      return {
        ...state,
        preview: {
          ...state.preview,
          navigation,
        },
      };
    }

    case ACTION_TYPES.NAV_PUSH: {
      let navigation;
      try { navigation = updateNavigationHistory(state.preview?.navigation, action.screenRef || action.fileId); }
      catch { return state; }
      return {
        ...state,
        preview: {
          ...state.preview,
          navigation,
        },
      };
    }

    case ACTION_TYPES.NAV_SET_INDEX: {
      const prev = state.preview?.navigation || { enabled: false, stack: [], index: -1, actionMap: {} };
      const prevStack = Array.isArray(prev.stack) ? prev.stack : [];
      if (!prevStack.length) {
        if (prev.index === -1) return state;
        return {
          ...state,
          preview: {
            ...state.preview,
            navigation: {
              ...prev,
              index: -1,
            },
          },
        };
      }
      const rawIndex = Number(action.index);
      const idx = Number.isFinite(rawIndex)
        ? Math.max(0, Math.min(prevStack.length - 1, Math.trunc(rawIndex)))
        : prev.index;
      if (idx === prev.index) return state;
      return {
        ...state,
        preview: {
          ...state.preview,
          navigation: {
            ...prev,
            index: idx,
          },
        },
      };
    }

    case ACTION_TYPES.NAV_SET_ACTION_MAPPING: {
      const prev = state.preview?.navigation || { enabled: false, stack: [], index: -1, actionMap: {} };
      let actionMap;
      try { actionMap = setNavigationMapping(prev.actionMap, action); } catch { return state; }
      return {
        ...state,
        preview: {
          ...state.preview,
          navigation: {
            ...prev,
            actionMap,
          },
        },
      };
    }

    case ACTION_TYPES.NAV_REMOVE_ACTION_MAPPING: {
      const actionId = String(action.actionId || '').trim();
      if (!actionId) return state;
      const prev = state.preview?.navigation || { enabled: false, stack: [], index: -1, actionMap: {} };
      const nextMap = removeNavigationMapping(prev.actionMap, actionId, action.source, action.legacy);
      return {
        ...state,
        preview: {
          ...state.preview,
          navigation: {
            ...prev,
            actionMap: nextMap,
          },
        },
      };
    }

    case ACTION_TYPES.NAV_CLEAR_ACTION_MAPPINGS: {
      const prev = state.preview?.navigation || { enabled: false, stack: [], index: -1, actionMap: {} };
      const prevMap = prev.actionMap && typeof prev.actionMap === 'object' ? prev.actionMap : {};
      if (!Object.keys(prevMap).length) return state;
      return {
        ...state,
        preview: {
          ...state.preview,
          navigation: {
            ...prev,
            actionMap: {},
          },
        },
      };
    }

    // Projection and successful history move are one observable state change.
    case ACTION_TYPES.NAV_COMMIT: {
      const file = action.file;
      if (!file?.id || file.kind !== 'screen') return state;
      let navigation;
      try { navigation = updateNavigationHistory(state.preview?.navigation, action.screenRef, action.mode, action.index, action.origin); }
      catch { return state; }
      return {
        ...state,
        files: { ...state.files, currentFileId: file.id,
          openFileIds: state.files.openFileIds.includes(file.id) ? state.files.openFileIds : [...state.files.openFileIds, file.id],
          byId: { ...state.files.byId, [file.id]: file } },
        editor: { ...state.editor, selection: { nodeId: null } },
        preview: { ...state.preview, navigation },
      };
    }

    case ACTION_TYPES.SET_PREVIEW_LOCALE: {
      const locale = String(action.locale || '').trim();
      if (!locale) return state;
      if (state.ui.previewLocale === locale) return state;
      return {
        ...state,
        ui: {
          ...state.ui,
          previewLocale: locale,
        },
      };
    }

    case ACTION_TYPES.SET_PREVIEW_FONT_PROFILE: {
      const profile = action.profile;
      if (!['bitmap', 'observed-smooth'].includes(profile) || state.ui.previewFontProfile === profile) return state;
      return { ...state, ui: { ...state.ui, previewFontProfile: profile } };
    }

    case ACTION_TYPES.SET_PROJECT: {
      // Reset per-project working set (open files, selection) on project change.
      // Keep UI preferences (panels, tabs, debug) intact.
      return {
        ...state,
        project: action.project,
        files: {
          openFileIds: [],
          currentFileId: null,
          byId: {},
        },
        editor: {
          ...state.editor,
          selection: { nodeId: null },
        },
        preview: {
          ...state.preview,
          navigation: {
            enabled: false,
            stack: [],
            index: -1,
            actionMap: {},
          },
        },
      };
    }

    case ACTION_TYPES.PACK_IMPORT_START: {
      return {
        ...state,
        project: null,
        pack: {
          status: 'loading',
          errorMessage: null,
          imported: null,
        },
        files: {
          openFileIds: [],
          currentFileId: null,
          byId: {},
        },
        editor: {
          ...state.editor,
          selection: { nodeId: null },
        },
        preview: {
          ...state.preview,
          navigation: {
            enabled: false,
            stack: [],
            index: -1,
            actionMap: {},
          },
        },
      };
    }

    case ACTION_TYPES.PACK_IMPORT_SUCCESS: {
      return {
        ...state,
        pack: {
          status: 'ready',
          errorMessage: null,
          imported: action.pack,
        },
      };
    }

    case ACTION_TYPES.PACK_IMPORT_ERROR: {
      return {
        ...state,
        pack: {
          status: 'error',
          errorMessage: action.errorMessage || 'Import failed.',
          imported: null,
        },
      };
    }

    case ACTION_TYPES.PACK_UNLOAD: {
      return {
        ...state,
        project: null,
        pack: {
          status: 'idle',
          errorMessage: null,
          imported: null,
        },
        files: {
          openFileIds: [],
          currentFileId: null,
          byId: {},
        },
        editor: {
          ...state.editor,
          selection: { nodeId: null },
        },
        preview: {
          ...state.preview,
          navigation: {
            enabled: false,
            stack: [],
            index: -1,
            actionMap: {},
          },
        },
      };
    }

    case ACTION_TYPES.OPEN_FILE: {
      const file = action.file;
      if (!file || !file.id) return state;

      const alreadyOpen = state.files.openFileIds.includes(file.id);
      const nextOpenFileIds = alreadyOpen
        ? state.files.openFileIds
        : [...state.files.openFileIds, file.id];

      return {
        ...state,
        files: {
          ...state.files,
          openFileIds: nextOpenFileIds,
          currentFileId: file.id,
          byId: {
            ...state.files.byId,
            [file.id]: file,
          },
        },
        editor: {
          ...state.editor,
          selection: { nodeId: null },
        },
      };
    }

    case ACTION_TYPES.CLOSE_FILE: {
      const fileId = action.fileId;
      if (!fileId || !state.files.openFileIds.includes(fileId)) return state;

      const nextOpenFileIds = state.files.openFileIds.filter((id) => id !== fileId);
      const nextById = { ...state.files.byId };
      delete nextById[fileId];

      const nextCurrentFileId =
        state.files.currentFileId === fileId
          ? nextOpenFileIds.length > 0
            ? nextOpenFileIds[nextOpenFileIds.length - 1]
            : null
          : state.files.currentFileId;

      return {
        ...state,
        files: {
          ...state.files,
          openFileIds: nextOpenFileIds,
          currentFileId: nextCurrentFileId,
          byId: nextById,
        },
        editor: {
          ...state.editor,
          selection: { nodeId: null },
        },
      };
    }

    case ACTION_TYPES.SET_CURRENT_FILE: {
      const fileId = action.fileId;
      if (!fileId || !state.files.openFileIds.includes(fileId)) return state;
      if (state.files.currentFileId === fileId) return state;

      return {
        ...state,
        files: {
          ...state.files,
          currentFileId: fileId,
        },
        editor: {
          ...state.editor,
          selection: { nodeId: null },
        },
      };
    }

    case ACTION_TYPES.PATCH_FILE: {
      const fileId = action.fileId;
      if (!fileId) return state;

      const file = state.files.byId[fileId];
      if (!file) return state;

      const patch = action.patch && typeof action.patch === 'object' ? action.patch : {};
      const nextFile = {
        ...file,
        ...patch,
        id: file.id,
      };

      return {
        ...state,
        files: {
          ...state.files,
          byId: {
            ...state.files.byId,
            [fileId]: nextFile,
          },
        },
      };
    }

    case ACTION_TYPES.PATCH_FILES: {
      const updates = Array.isArray(action.updates) ? action.updates.slice(0, 5000) : [];
      if (!updates.length) return state;
      let nextById = state.files.byId;
      let changed = false;
      for (const update of updates) {
        const fileId = update && update.fileId;
        // Re-read from the progressively updated map so multiple patches for
        // one file compose in declaration order instead of the last patch
        // discarding every earlier field.
        const file = fileId ? nextById[fileId] : null;
        if (!file) continue;
        const patch = update.patch && typeof update.patch === 'object' ? update.patch : {};
        if (!changed) nextById = { ...state.files.byId };
        nextById[fileId] = { ...file, ...patch, id: file.id };
        changed = true;
      }
      if (!changed) return state;
      return {
        ...state,
        files: {
          ...state.files,
          byId: nextById,
        },
      };
    }

    case ACTION_TYPES.SELECT_NODE: {
      if (state.editor.selection.nodeId === action.nodeId) return state;
      return {
        ...state,
        editor: {
          ...state.editor,
          selection: { nodeId: action.nodeId },
        },
      };
    }

    case ACTION_TYPES.CLEAR_SELECTION: {
      if (state.editor.selection.nodeId === null) return state;
      return {
        ...state,
        editor: {
          ...state.editor,
          selection: { nodeId: null },
        },
      };
    }

    case ACTION_TYPES.UPDATE_PROPERTY: {
      const currentFileId = state.files.currentFileId;
      if (!currentFileId) return state;

      const file = state.files.byId[currentFileId];
      if (!file) return state;

      const nodeId = action.nodeId;
      const propKey = action.key;
      const propValue = action.value;
      if (!nodeId || !propKey) return state;

      const node = file.nodesById[nodeId];
      if (!node) return state;

      const prevValue = node.props[propKey];
      if (prevValue === propValue) return state;

      const nextNode = {
        ...node,
        props: {
          ...node.props,
          [propKey]: propValue,
        },
      };

      const nextFile = {
        ...file,
        dirty: true,
        nodesById: {
          ...file.nodesById,
          [nodeId]: nextNode,
        },
      };

      return {
        ...state,
        files: {
          ...state.files,
          byId: {
            ...state.files.byId,
            [currentFileId]: nextFile,
          },
        },
      };
    }

    default:
      return state;
  }
}

/**
 * @param {{ initialState: AppState, reducer: (state: AppState, action: any) => AppState }} params
 */
export function createStore({ initialState, reducer }) {
  let state = initialState;
  /** @type {Set<(next: AppState, prev: AppState, action: any) => void>} */
  const subscribers = new Set();
  const events = createEventBus();

  function getState() {
    return state;
  }

  /**
   * @param {(next: AppState, prev: AppState, action: any) => void} fn
   */
  function subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }

  /**
   * @param {{type: string, [k: string]: any}} action
   */
  function dispatch(action) {
    const prev = state;
    const next = reducer(state, action);
    state = next;

    events.emit('action', { action, prev, next });
    if (next !== prev) {
      for (const fn of Array.from(subscribers)) {
        try {
          fn(next, prev, action);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[store] subscriber error', err);

          // Best-effort report to global diagnostics if installed.
          let wasReporting = false;
          try {
            /** @type {any} */
            const g = globalThis;
            wasReporting = Boolean(g.__JSONUI_DIAGNOSTICS_REPORTING__);
            if (!wasReporting) g.__JSONUI_DIAGNOSTICS_REPORTING__ = true;

            if (!wasReporting) {
              const diag = g.__JSONUI_DIAGNOSTICS__;
              if (diag && typeof diag.captureError === 'function') {
                diag.captureError(err, {
                  source: 'store',
                  message: 'store subscriber error',
                  data: { actionType: action?.type },
                });
              }
            }
          } catch {
            // ignore
          } finally {
            try {
              /** @type {any} */
              const g = globalThis;
              if (!wasReporting) g.__JSONUI_DIAGNOSTICS_REPORTING__ = false;
            } catch {
              // ignore
            }
          }
        }
      }
      events.emit('change', { action, prev, next });
    }

    return action;
  }

  return {
    getState,
    dispatch,
    subscribe,
    events,
  };
}

export const actions = {
  /** @param {string} route */
  setRoute: (route) => ({ type: ACTION_TYPES.SET_ROUTE, route }),

  toggleDebug: () => ({ type: ACTION_TYPES.TOGGLE_DEBUG }),

  /** @param {{ leftPx: number, rightPx: number }} params */
  setPanelSizes: ({ leftPx, rightPx }) => ({
    type: ACTION_TYPES.SET_PANEL_SIZES,
    leftPx,
    rightPx,
  }),

  /** @param {string} locale */
  setPreviewLocale: (locale) => ({ type: ACTION_TYPES.SET_PREVIEW_LOCALE, locale }),
  setPreviewFontProfile: (profile) => ({ type: ACTION_TYPES.SET_PREVIEW_FONT_PROFILE, profile }),

  /** @param {Record<string, any>} mockData */
  setMockData: (mockData) => ({ type: ACTION_TYPES.SET_MOCK_DATA, mockData }),

  /** @param {boolean} enabled */
  setPreviewNavEnabled: (enabled) => ({ type: ACTION_TYPES.SET_PREVIEW_NAV_ENABLED, enabled }),

  /** @param {string} fileId */
  navReset: (screenRef) => ({ type: ACTION_TYPES.NAV_RESET, screenRef }),

  /** @param {string} fileId */
  navPush: (screenRef) => ({ type: ACTION_TYPES.NAV_PUSH, screenRef }),

  /** @param {number} index */
  navSetIndex: (index) => ({ type: ACTION_TYPES.NAV_SET_INDEX, index }),

  /**
   * @param {{ actionId: string, fileId: string }} params
   */
  navSetActionMapping: ({ actionId, fileId, source = null, target }) => ({
    type: ACTION_TYPES.NAV_SET_ACTION_MAPPING,
    actionId,
    fileId,
    source,
    target,
  }),

  /** @param {string} actionId */
  navRemoveActionMapping: (actionId, source = null, legacy = false) => ({ type: ACTION_TYPES.NAV_REMOVE_ACTION_MAPPING, actionId, source, legacy }),

  navCommit: (payload) => ({ type: ACTION_TYPES.NAV_COMMIT, ...payload }),

  navClearActionMappings: () => ({ type: ACTION_TYPES.NAV_CLEAR_ACTION_MAPPINGS }),

  /**
   * @param {{ area: 'center'|'right', tabId: string }} params
   */
  setEditorTab: ({ area, tabId }) => ({
    type: ACTION_TYPES.SET_EDITOR_TAB,
    area,
    tabId,
  }),

  /** @param {ProjectMeta|null} project */
  setProject: (project) => ({ type: ACTION_TYPES.SET_PROJECT, project }),

  /** @returns {{type: string}} */
  packImportStart: () => ({ type: ACTION_TYPES.PACK_IMPORT_START }),
  /** @param {ImportedPack} pack */
  packImportSuccess: (pack) => ({ type: ACTION_TYPES.PACK_IMPORT_SUCCESS, pack }),
  /** @param {string} errorMessage */
  packImportError: (errorMessage) => ({ type: ACTION_TYPES.PACK_IMPORT_ERROR, errorMessage }),
  packUnload: () => ({ type: ACTION_TYPES.PACK_UNLOAD }),

  /** @param {OpenFile} file */
  openFile: (file) => ({ type: ACTION_TYPES.OPEN_FILE, file }),
  /** @param {string} fileId */
  closeFile: (fileId) => ({ type: ACTION_TYPES.CLOSE_FILE, fileId }),
  /** @param {string} fileId */
  setCurrentFile: (fileId) => ({ type: ACTION_TYPES.SET_CURRENT_FILE, fileId }),

  /**
   * Patch an existing open file in-place (immutably).
   * @param {{ fileId: string, patch: Partial<OpenFile> & Record<string, any> }} params
   */
  patchFile: ({ fileId, patch }) => ({ type: ACTION_TYPES.PATCH_FILE, fileId, patch }),

  /** @param {{ fileId: string, patch: Partial<OpenFile> & Record<string, any> }[]} updates */
  patchFiles: (updates) => ({ type: ACTION_TYPES.PATCH_FILES, updates }),

  /** @param {string} nodeId */
  selectNode: (nodeId) => ({ type: ACTION_TYPES.SELECT_NODE, nodeId }),
  clearSelection: () => ({ type: ACTION_TYPES.CLEAR_SELECTION }),

  /**
   * @param {{nodeId: string, key: string, value: any}} params
   */
  updateProperty: ({ nodeId, key, value }) => ({
    type: ACTION_TYPES.UPDATE_PROPERTY,
    nodeId,
    key,
    value,
  }),
};

/**
 * Convenience factory for the app.
 * @param {{ debug?: boolean }=} options
 */
export function createAppStore(options = {}) {
  const initialState = createInitialState();
  if (typeof options.debug === 'boolean') {
    initialState.ui.debug = options.debug;
  }

  const store = createStore({ initialState, reducer: appReducer });

  return store;
}
