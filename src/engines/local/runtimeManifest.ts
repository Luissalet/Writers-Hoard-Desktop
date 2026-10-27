import {LOCAL_RUNTIME_TRIAL_TOOLS} from './trialManifest';
import type {BridgeTool} from '@/services/aiBridge/schema';
export const LOCAL_RUNTIME_TOOLS:BridgeTool[]=[
  ...LOCAL_RUNTIME_TRIAL_TOOLS,
  {"name":"wh_local_package_errors","group":"research","writes":false,"schema":{"type":"object","properties":{"namespace":{"type":"string","pattern":"^[a-z][a-z0-9-]*\\.[a-z][a-z0-9-]*(?:\\.[a-z][a-z0-9-]*)*$","maxLength":80},"contentHash":{"type":"string","pattern":"^[a-f0-9]{64}$"},"phase":{"type":"string","enum":["load","factory","prepare","persist","publish","notify","render","operation"]}},"additionalProperties":false},"description":"List local runtime package errors from this renderer session only. Does not load code or read/write project data. Optional package/member namespace, content hash and phase filters match together."},
  {"name":"wh_local_package_errors_clear","group":"research","writes":true,"schema":{"type":"object","properties":{"namespace":{"type":"string","pattern":"^[a-z][a-z0-9-]*\\.[a-z][a-z0-9-]*(?:\\.[a-z][a-z0-9-]*)*$","maxLength":80},"contentHash":{"type":"string","pattern":"^[a-f0-9]{64}$"},"phase":{"type":"string","enum":["load","factory","prepare","persist","publish","notify","render","operation"]}},"additionalProperties":false},"description":"Explicitly clear matching local runtime errors from this renderer session only. Does not remove installed packages, pins, loader availability, boundary state or project data."},
  {
    "name": "wh_local_package_inspect",
    "group": "research",
    "writes": false,
    "schema": {
      "type": "object",
      "properties": {
        "file": {
          "type": "object",
          "properties": {
            "name": {
              "type": "string",
              "minLength": 1
            },
            "mime": {
              "type": "string",
              "enum": [
                "application/json",
                "application/octet-stream"
              ]
            },
            "base64": {
              "type": "string",
              "minLength": 1
            }
          },
          "required": [
            "name",
            "mime",
            "base64"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "file"
      ],
      "additionalProperties": false
    },
    "description": "Inspect a canonical own local runtime package from complete JSON bytes without executing its code or writing data. No filesystem path or URL."
  },
  {
    "name": "wh_local_package_install",
    "group": "research",
    "writes": true,
    "schema": {
      "type": "object",
      "properties": {
        "file": {
          "type": "object",
          "properties": {
            "name": {
              "type": "string",
              "minLength": 1
            },
            "mime": {
              "type": "string",
              "enum": [
                "application/json",
                "application/octet-stream"
              ]
            },
            "base64": {
              "type": "string",
              "minLength": 1
            }
          },
          "required": [
            "name",
            "mime",
            "base64"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "file"
      ],
      "additionalProperties": false
    },
    "description": "Install a verified own runtime package into the local inventory and publish its complete app/tool batch. Does not enable engines or change project pins. No rebuild required."
  },
  {
    "name": "wh_local_package_list",
    "group": "research",
    "writes": false,
    "schema": {
      "type": "object",
      "properties": {
        "namespace": {
          "type": "string",
          "pattern": "^[a-z][a-z0-9-]*\\.[a-z][a-z0-9-]*(?:\\.[a-z][a-z0-9-]*)*$",
          "maxLength": 80
        }
      },
      "required": [],
      "additionalProperties": false
    },
    "description": "List immutable locally installed runtime packages and their availability. Does not evaluate code. Optional namespace matches package or member."
  },
  {
    "name": "wh_local_package_export",
    "group": "research",
    "writes": false,
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
    },
    "description": "Export one exact locally installed package as complete base64 JSON bytes. No disk path, no implicit code in project backups, no truncation."
  }
];
