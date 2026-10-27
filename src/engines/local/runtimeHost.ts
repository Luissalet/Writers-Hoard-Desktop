import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import * as sdk from './sdk';
import * as apps from './apps';
/** The renderer's actual hooks and contexts; no second React/SDK bundle. */
export const localRuntimeHost=Object.freeze({React,jsxRuntime,sdk,apps});
