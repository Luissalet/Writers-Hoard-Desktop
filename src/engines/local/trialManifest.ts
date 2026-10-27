import type {BridgeTool} from '@/services/aiBridge/schema';
export const LOCAL_RUNTIME_TRIAL_TOOLS:BridgeTool[]=[
  {
    "name": "wh_local_package_trial_create",
    "group": "research",
    "writes": true,
    "description": "Create one normal trial project from an installed package member and the explicitly selected complete app-tool dependency set. Enables and pins only that new project; no navigation or implicit package installation.",
    "schema": {
      "type": "object",
      "properties": {
        "contentHash": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "namespace": {
          "type": "string",
          "pattern": "^[a-z][a-z0-9-]*\\.[a-z][a-z0-9-]*(?:\\.[a-z][a-z0-9-]*)*$",
          "maxLength": 80
        },
        "title": {
          "type": "string",
          "minLength": 1
        },
        "tools": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "namespace": {
                "type": "string",
                "pattern": "^[a-z][a-z0-9-]*\\.[a-z][a-z0-9-]*(?:\\.[a-z][a-z0-9-]*)*$",
                "maxLength": 80
              },
              "contentHash": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              }
            },
            "required": [
              "namespace",
              "contentHash"
            ],
            "additionalProperties": false
          }
        }
      },
      "required": [
        "contentHash",
        "namespace",
        "title",
        "tools"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "wh_local_package_trial_keep",
    "group": "research",
    "writes": true,
    "description": "Keep one normal trial project, comparing its current package marker; remove only the trial marker, preserving pins, documents and editor drafts.",
    "schema": {
      "type": "object",
      "properties": {
        "projectId": {
          "type": "string",
          "minLength": 1
        },
        "contentHash": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        }
      },
      "required": [
        "projectId",
        "contentHash"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "wh_local_package_trial_discard",
    "group": "research",
    "writes": true,
    "description": "Discard only the marked trial project after normal pending writes and drafts resolve. Refuses a changed marker or unresolved draft; installed packages and other projects remain.",
    "schema": {
      "type": "object",
      "properties": {
        "projectId": {
          "type": "string",
          "minLength": 1
        },
        "contentHash": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        }
      },
      "required": [
        "projectId",
        "contentHash"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "wh_local_package_usage",
    "group": "research",
    "writes": false,
    "description": "Read saved project pins and retained singleton/document/era/archive instances for each member namespace of an installed package. Reports the current project pin, not historical per-document code or active mounts. No evaluation or writes.",
    "schema": {
      "type": "object",
      "properties": {
        "contentHash": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        }
      },
      "required": [
        "contentHash"
      ],
      "additionalProperties": false
    }
  }
];
