/** 編集範囲・操作領域の独立検証 fixture。実機の合格証拠ではない。
 * 添付 mcpack の原文構造を必要な枝だけ抽出。各 documents 値は JSONC 文字列。
 * 読込時 I/O なし。変更する場合は structuredClone で複製すること。 */
const encode = values => Object.fromEntries(Object.entries(values).map(([path, value]) =>
  [path, `// revision20: 実ソース由来の縮約 fixture\n${JSON.stringify(value, null, 2)}\n`]));

export const scoped20SourceEvidence = {
  "archive": "jsonui_selected_2026-09-10T00-28-39-813Z.mcpack",
  "archiveSha256": "8dd6605785b44cb603131fc9b472cea7857e4f63d226be446abbda872d9c2c4b",
  "sources": [
    {
      "path": "ui/ui_common.json",
      "sha256": "730d7a0b6dc38830d2dcd0978780fd5e07f2fe5cc354db976ba2e532548297ff"
    },
    {
      "path": "ui/invbg_player_inventory.json",
      "sha256": "c691d188158eada13ad01ffff1ee202214bcdb2abc33c2eab81b24cea120fca6"
    }
  ],
  "normalization": "移動単位の比較用に既存 offset 3 件を除去。無関係な装飾/TTS/collection bindings と補助要素を縮約。入力型、状態名、操作 mapping、相対継承、動的参照を保持。",
  "sourceOffsets": {
    "close_button_image": [
      -77.959,
      25
    ],
    "text_default": [
      -12.829,
      59.21
    ],
    "cell_base": [
      -0.329,
      14.802
    ]
  }
};

const normalizedSourceObjects = {
  "ui/ui_common.json": {
    "namespace": "common",
    "close_button": {
      "type": "button",
      "size": [
        21,
        21
      ],
      "layer": 10,
      "anchor_from": "top_right",
      "anchor_to": "top_right",
      "$close_button_offset|default": [
        -2,
        2
      ],
      "offset": "$close_button_offset",
      "locked_control": "",
      "default_control": "default",
      "hover_control": "hover",
      "pressed_control": "pressed",
      "$close_button_panel_size|default": [
        15,
        15
      ],
      "$close_button_to_button_id|default": "button.menu_exit",
      "$default_button_alpha|default": 1,
      "$close_button_default_texture|default": "textures/ui/close_button_default",
      "button_mappings": [
        {
          "from_button_id": "button.menu_select",
          "to_button_id": "$close_button_to_button_id",
          "mapping_type": "pressed"
        },
        {
          "from_button_id": "button.menu_ok",
          "to_button_id": "$close_button_to_button_id",
          "mapping_type": "focused"
        }
      ],
      "controls": [
        {
          "default@common.close_button_panel": {
            "$close_button_texture": "$close_button_default_texture",
            "$button_alpha": "$default_button_alpha"
          }
        },
        {
          "hover@common.close_button_panel": {
            "$close_button_texture": "textures/ui/close_button_hover"
          }
        },
        {
          "pressed@common.close_button_panel": {
            "$close_button_texture": "textures/ui/close_button_pressed"
          }
        }
      ]
    },
    "close_button_panel": {
      "type": "panel",
      "layer": 1,
      "size": "$close_button_panel_size",
      "$button_alpha|default": 1,
      "controls": [
        {
          "close_button_image@close_button_image": {
            "alpha": "$button_alpha"
          }
        }
      ]
    },
    "close_button_image": {
      "type": "image",
      "layer": 1,
      "texture": "$close_button_texture"
    },
    "edit_box_indent": {
      "type": "image",
      "texture": "textures/ui/edit_box_indent",
      "alpha": "$alpha",
      "$alpha|default": 1
    },
    "edit_box_indent_hover@common.edit_box_indent": {
      "texture": "textures/ui/edit_box_indent_hover"
    },
    "cell_image": {
      "type": "image",
      "texture": "textures/ui/cell_image",
      "layer": 1
    },
    "text_edit_box": {
      "type": "edit_box",
      "focus_enabled": true,
      "anchor_from": "center",
      "anchor_to": "center",
      "layer": 1,
      "locked_control": "locked",
      "default_control": "default",
      "hover_control": "hover",
      "pressed_control": "pressed",
      "$text_edit_text_control|default": "display_text",
      "text_control": "$text_edit_text_control",
      "$text_background_default": "common.edit_box_indent",
      "$text_background_hover": "common.edit_box_indent_hover",
      "button_mappings": [
        {
          "from_button_id": "button.menu_select",
          "to_button_id": "$text_edit_box_selected_to_button_id",
          "handle_select": true,
          "handle_deselect": false,
          "mapping_type": "pressed"
        },
        {
          "from_button_id": "button.menu_select",
          "to_button_id": "$text_edit_box_selected_to_button_id",
          "handle_select": false,
          "handle_deselect": true,
          "mapping_type": "global",
          "consume_event": false
        },
        {
          "from_button_id": "button.menu_ok",
          "to_button_id": "$text_edit_box_selected_to_button_id",
          "handle_select": true,
          "handle_deselect": true,
          "mapping_type": "pressed"
        },
        {
          "from_button_id": "button.menu_ok",
          "to_button_id": "$text_edit_box_selected_to_button_id",
          "handle_select": false,
          "handle_deselect": true,
          "mapping_type": "global"
        },
        {
          "from_button_id": "button.menu_cancel",
          "to_button_id": "$text_edit_box_deselected_to_button_id",
          "handle_select": false,
          "handle_deselect": true,
          "mapping_type": "global"
        },
        {
          "to_button_id": "$text_edit_box_hovered_button_id",
          "mapping_type": "pressed"
        },
        {
          "from_button_id": "$text_edit_box_clear_from_button_id",
          "to_button_id": "$text_edit_box_clear_to_button_id",
          "handle_select": false,
          "handle_deselect": false,
          "mapping_type": "focused"
        }
      ],
      "controls": [
        {
          "centering_panel": {
            "type": "panel",
            "size": [
              "100% - 6px",
              "100% - 4px"
            ],
            "controls": [
              {
                "display_text": {
                  "type": "label",
                  "text": "入力内容",
                  "layer": 1
                }
              }
            ]
          }
        },
        {
          "locked": {
            "type": "panel",
            "$disabled_color|default": "$color",
            "controls": [
              {
                "edit_box_indent@$text_background_default": {
                  "$color": "$disabled_color",
                  "$alpha": "$disabled_alpha"
                }
              }
            ]
          }
        },
        {
          "default@$text_background_default": {}
        },
        {
          "hover@$text_background_hover": {}
        },
        {
          "pressed@$text_background_hover": {}
        }
      ],
      "$disabled_color|default": [
        1,
        1,
        1
      ],
      "$disabled_alpha|default": 0.5,
      "$color|default": [
        1,
        1,
        1
      ]
    },
    "container_item": {
      "type": "input_panel",
      "size": [
        18,
        18
      ],
      "layer": 1,
      "$cell_image_size|default": [
        18,
        18
      ],
      "$button_ref|default": "common.container_slot_button_prototype",
      "$background_images|default": "common.cell_image_panel",
      "$background_image_control_name|default": "bg",
      "focus_enabled": true,
      "controls": [
        {
          "item_cell": {
            "type": "panel",
            "size": "$cell_image_size",
            "layer": 0,
            "controls": [
              {
                "$background_image_control_name@$background_images": {
                  "layer": 1
                }
              }
            ]
          }
        },
        {
          "item_cell_overlay_ref": {
            "type": "panel",
            "layer": 3
          }
        },
        {
          "item_selected_image": {
            "type": "image",
            "texture": "textures/ui/slot_selected",
            "layer": 4
          }
        },
        {
          "item_button_ref@$button_ref": {
            "tts_ignore_count": true,
            "tts_skip_message": true,
            "tts_inherit_siblings": true,
            "layer": 5
          }
        }
      ]
    },
    "container_slot_button_prototype": {
      "type": "button",
      "button_mappings": [
        {
          "from_button_id": "button.menu_select",
          "to_button_id": "button.container_take_all_place_all",
          "mapping_type": "pressed"
        },
        {
          "from_button_id": "button.menu_ok",
          "to_button_id": "button.container_take_all_place_all",
          "mapping_type": "pressed"
        },
        {
          "from_button_id": "button.controller_back",
          "to_button_id": "button.container_take_all_place_all",
          "mapping_type": "pressed",
          "ignored": "(not $is_ps4)"
        },
        {
          "from_button_id": "button.menu_secondary_select",
          "to_button_id": "button.container_take_half_place_one",
          "mapping_type": "pressed"
        },
        {
          "from_button_id": "button.controller_select",
          "to_button_id": "button.container_take_half_place_one",
          "mapping_type": "pressed"
        },
        {
          "from_button_id": "button.menu_auto_place",
          "to_button_id": "button.container_auto_place",
          "mapping_type": "pressed"
        },
        {
          "from_button_id": "button.controller_secondary_select",
          "to_button_id": "button.container_auto_place",
          "mapping_type": "pressed"
        },
        {
          "from_button_id": "button.menu_inventory_drop",
          "to_button_id": "button.drop_one",
          "mapping_type": "pressed"
        },
        {
          "from_button_id": "button.menu_inventory_drop_all",
          "to_button_id": "button.drop_all",
          "mapping_type": "pressed"
        },
        {
          "from_button_id": "button.menu_select",
          "to_button_id": "button.coalesce_stack",
          "mapping_type": "double_pressed"
        },
        {
          "from_button_id": "button.menu_ok",
          "to_button_id": "button.coalesce_stack",
          "mapping_type": "double_pressed"
        },
        {
          "to_button_id": "button.shape_drawing",
          "mapping_type": "pressed"
        },
        {
          "to_button_id": "button.container_slot_hovered",
          "mapping_type": "pressed"
        }
      ]
    },
    "cell_image_panel": {
      "type": "panel",
      "controls": [
        {
          "cell_image@common.cell_image": {}
        }
      ]
    }
  },
  "ui/invbg_player_inventory.json": {
    "namespace": "invbg_662db7c61e5f",
    "cell_image": {
      "type": "image",
      "texture": "textures/invbg_662db7c61e5f/slots/player_slot_classic",
      "$cell_image_size|default": [
        "default",
        "default"
      ],
      "size": "$cell_image_size"
    },
    "container_cell_images": {
      "type": "panel",
      "$cell_images_binding_condition|default": "visible",
      "bindings": [
        {
          "binding_name": "#container_item_background",
          "binding_type": "collection",
          "binding_collection_name": "$item_collection_name",
          "binding_condition": "$cell_images_binding_condition"
        }
      ],
      "controls": [
        {
          "cell_base@invbg_662db7c61e5f.cell_image": {}
        }
      ]
    }
  },
  "ui/fixture_screens.json": {
    "namespace": "fixture",
    "screen_a": {
      "type": "screen",
      "size": [
        320,
        240
      ],
      "controls": [
        {
          "close@common.close_button": {}
        },
        {
          "text@common.text_edit_box": {
            "size": [
              80,
              20
            ],
            "offset": [
              0,
              30
            ]
          }
        },
        {
          "slot@common.container_item": {
            "offset": [
              0,
              60
            ],
            "$background_images": "invbg_662db7c61e5f.container_cell_images"
          }
        }
      ]
    },
    "screen_b": {
      "type": "screen",
      "size": [
        320,
        240
      ],
      "controls": [
        {
          "close@common.close_button": {}
        },
        {
          "text@common.text_edit_box": {
            "size": [
              80,
              20
            ],
            "offset": [
              0,
              30
            ]
          }
        },
        {
          "slot@common.container_item": {
            "offset": [
              0,
              60
            ],
            "$background_images": "invbg_662db7c61e5f.container_cell_images"
          }
        }
      ]
    }
  },
  "ui/pocket/fixture_pocket.json": {
    "namespace": "fixture",
    "pocket_screen": {
      "type": "screen",
      "size": [
        320,
        240
      ],
      "controls": [
        {
          "close@common.close_button": {}
        },
        {
          "text@common.text_edit_box": {
            "size": [
              80,
              20
            ],
            "offset": [
              0,
              30
            ]
          }
        },
        {
          "slot@common.container_item": {
            "offset": [
              0,
              60
            ],
            "$background_images": "invbg_662db7c61e5f.container_cell_images"
          }
        }
      ]
    }
  }
};

// 縮約した操作 mapping の実ソース既定値を保持する。
Object.assign(normalizedSourceObjects['ui/ui_common.json'].text_edit_box, {
  '$text_edit_box_hovered_button_id|default': 'button.text_edit_box_hovered',
  '$text_edit_box_clear_from_button_id|default': 'button.menu_clear',
  '$text_edit_box_clear_to_button_id|default': 'button.text_edit_box_clear',
  '$text_edit_box_selected_to_button_id|default': 'button.text_edit_box_selected',
  '$text_edit_box_deselected_to_button_id|default': 'button.text_edit_box_deselected',
});
for (const [path, name] of [['ui/fixture_screens.json', 'screen_a'], ['ui/fixture_screens.json', 'screen_b'],
  ['ui/pocket/fixture_pocket.json', 'pocket_screen']]) {
  normalizedSourceObjects[path][name].$item_collection_name = 'fixture_items';
}

export const scoped20Documents = encode(normalizedSourceObjects);
export const scoped20Screen = 'fixture.screen_a';
export const scoped20ComparisonScreens = ['fixture.screen_b', 'fixture.pocket_screen'];

// 添付の既存 offset を保持した再現用入力。正常化版とは混同しない。
const uploadedSourceObjects = structuredClone(normalizedSourceObjects);
uploadedSourceObjects['ui/ui_common.json'].close_button_panel.controls[0]['close_button_image@close_button_image'].offset = scoped20SourceEvidence.sourceOffsets.close_button_image;
uploadedSourceObjects['ui/ui_common.json'].text_edit_box.controls[2]['default@$text_background_default'].offset = scoped20SourceEvidence.sourceOffsets.text_default;
uploadedSourceObjects['ui/invbg_player_inventory.json'].container_cell_images.controls[0]['cell_base@invbg_662db7c61e5f.cell_image'].offset = scoped20SourceEvidence.sourceOffsets.cell_base;
export const scoped20UploadedDocuments = encode(uploadedSourceObjects);

export const scoped20Cases = [
  {
    id: 'close-image', screen: scoped20Screen,
    effectivePointer: '/screen_a/controls/0/close/controls/0/default/controls/0/close_button_image',
    expectedInteractiveType: 'button', expectedInteractivePointer: '/screen_a/controls/0/close',
    sourcePath: 'ui/ui_common.json', sourcePointer: '/close_button_panel/controls/0/close_button_image@close_button_image',
    expectedStateControls: ['default', 'hover', 'pressed'],
  },
  {
    id: 'text-default', screen: scoped20Screen,
    effectivePointer: '/screen_a/controls/1/text/controls/2/default',
    expectedInteractiveType: 'edit_box', expectedInteractivePointer: '/screen_a/controls/1/text',
    sourcePath: 'ui/ui_common.json', sourcePointer: '/text_edit_box/controls/2/default@$text_background_default',
    expectedStateControls: ['locked', 'default', 'hover', 'pressed'],
  },
  {
    id: 'slot-cell-base', screen: scoped20Screen,
    effectivePointer: '/screen_a/controls/2/slot/controls/0/item_cell/controls/0/bg/controls/0/cell_base',
    expectedInteractiveType: 'input_panel', expectedInteractivePointer: '/screen_a/controls/2/slot',
    sourcePath: 'ui/invbg_player_inventory.json', sourcePointer: '/container_cell_images/controls/0/cell_base@invbg_662db7c61e5f.cell_image',
    expectedSiblingInteractivePointer: '/screen_a/controls/2/slot/controls/3/item_button_ref',
    expectedSiblingInteractiveType: 'button',
  },
];

const boundary = (id, values, extra) => ({ id, documents: encode(values), ...extra });
export const scoped20BoundaryFixtures = [
  boundary('same-namespace-relative-reference', {
    'ui/same_namespace.json': { namespace: 'same', image: { type: 'image', texture: 'textures/relative' },
      button: { type: 'button', controls: [{ 'default@image': {} }] },
      screen_a: { type: 'screen', controls: [{ 'button@button': {} }] },
      screen_b: { type: 'screen', controls: [{ 'button@button': {} }] } },
  }, { screen: 'same.screen_a', comparisonScreen: 'same.screen_b',
    effectivePointer: '/screen_a/controls/0/button/controls/0/default', expectedInteractiveType: 'button' }),
  boundary('dynamic-base-two-consumers', {
    'ui/dynamic.json': { namespace: 'dynamic',
      image: { type: 'image', texture: 'textures/dynamic' },
      button: { type: 'button', controls: [{ 'default@dynamic.image': {} }] },
      root: { type: 'screen', '$content|default': 'dynamic.button', controls: [{ 'chosen@$content': {} }] },
      'screen_a@dynamic.root': {}, 'screen_b@dynamic.root': {} },
  }, { screen: 'dynamic.screen_a', comparisonScreen: 'dynamic.screen_b',
    effectivePointer: '/screen_a/controls/0/chosen/controls/0/default', expectedInteractiveType: 'button' }),
  boundary('factory-repeat-template', {
    'ui/factory.json': { namespace: 'repeat',
      row: { type: 'button', controls: [{ default: { type: 'image', texture: 'textures/repeat' } }] },
      root: { type: 'stack_panel', collection_name: 'rows',
        factory: { name: 'row_factory', control_name: 'entry@repeat.row' } },
      'screen_a@repeat.root': {}, 'screen_b@repeat.root': {} },
  }, { screen: 'repeat.screen_a', comparisonScreen: 'repeat.screen_b',
    effectivePointer: '/screen_a/controls/0/entry/controls/0/default', expectedInteractiveType: 'button',
    generated: 'factory', representativeCollections: { rows: { count: 2 } } }),
  boundary('implicit-layer-base', {
    'vanilla/ui/layered.json': { namespace: 'layered', root: { type: 'screen',
      controls: [{ button: { type: 'button', controls: [{ default: { type: 'image', texture: 'textures/layer' } }] } }] } },
    'imported/ui/layered.json': { namespace: 'layered', root: {
      modifications: [{ array_name: 'controls', operation: 'insert_back', value: [{ extra: { type: 'label', text: '追加' } }] }] },
      'screen_a@layered.root': {}, 'screen_b@layered.root': {} },
  }, { screen: 'layered.screen_a', comparisonScreen: 'layered.screen_b',
    effectivePointer: '/screen_a/controls/0/button/controls/0/default', expectedInteractiveType: 'button',
    documentSources: {
      'vanilla/ui/layered.json': { sourceId: 'vanilla-fixture', kind: 'vanilla', precedence: 10, physicalPath: 'ui/layered.json', active: true },
      'imported/ui/layered.json': { sourceId: 'imported-fixture', kind: 'imported', precedence: 20, physicalPath: 'ui/layered.json', active: true },
    } }),
];
