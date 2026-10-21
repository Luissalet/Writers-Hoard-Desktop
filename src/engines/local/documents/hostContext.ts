import {createContext} from 'react';
/** Document identities currently embedded above this host; no depth policy. */
export const LocalToolHostAncestors=createContext<readonly string[]>([]);
