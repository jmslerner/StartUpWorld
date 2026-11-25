import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createLab, followAddress, type OfficeLabApi } from "./lab";
import { OfficeLab } from "./OfficeLab";
import "./lab.css";

declare global {
  interface Window {
    /** The lab page's handle for the browser checks. Only the lab page sets it. */
    __officeLab?: OfficeLabApi;
  }
}

// One lab for the life of the page: it is the view's scene source, and a new source would be a new world.
const lab = createLab(window.location.search, () => performance.now());
window.__officeLab = lab.api;
// The address bar follows the scene, so that any office on screen can be opened again from its address.
followAddress(lab, (query) => window.history.replaceState(null, "", `${window.location.pathname}${query}${window.location.hash}`));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <OfficeLab lab={lab} />
  </StrictMode>
);
