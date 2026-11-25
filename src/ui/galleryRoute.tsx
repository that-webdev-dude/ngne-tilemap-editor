// The development gallery route's module (src/ui/App.tsx): the package's gallery with its own
// stylesheet, after the package's `styles.css` (src/main.tsx), so the gallery's styles load
// with this route only and stay out of the production bundle (@ngne/editor-ui SPEC §12).
import "@ngne/editor-ui/gallery.css";

export { Gallery } from "@ngne/editor-ui/gallery";
