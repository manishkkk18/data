import "@fontsource/instrument-serif/400.css";
import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";
import "@fontsource/geist-mono/400.css";
import "@theme/base.css";
import "@theme/home.css";
import "./home.css";
import { setupContactForm } from "./contact";
import { setupSupport } from "./support";

type GoatCounter = { count?: (o: { path: string; title: string; event: boolean }) => void };
const track = (name: string) => (window as unknown as { goatcounter?: GoatCounter }).goatcounter?.count?.({ path: `india-from-data/${name}`, title: name, event: true });

setupContactForm(() => track("contact-sent"));
setupSupport(track);

document.querySelectorAll<HTMLAnchorElement>(".card a[href]").forEach((a) =>
  a.addEventListener("click", () => track(`explore-${a.closest<HTMLElement>(".card")?.dataset.app ?? "app"}`)),
);
