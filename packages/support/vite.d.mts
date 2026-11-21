import type { Plugin } from "vite";
/** Replaces <!--support:card--> in index.html with the support card. */
export function supportCard(opts?: { track?: string }): Plugin;
