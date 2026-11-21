// Vite plugin: replaces <!--support:card--> in a page's index.html with the support card.
//   plugins: [supportCard({ track: "india-night-lights" })]
// The page also imports packages/support/client.js and support.css.
import { supportCardHtml } from "./card.mjs";

export function supportCard({ track } = {}) {
  return {
    name: "support-card",
    async transformIndexHtml(html) {
      return html.includes("<!--support:card-->") ? html.replace("<!--support:card-->", await supportCardHtml({ track })) : html;
    },
  };
}
