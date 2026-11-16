# Logo tools

Regenerate the vector logo and every icon size from `branding/source/`.

Dependencies (install in a scratch folder, not in the app):

    npm install potrace@2.1.8 sharp@0.33.5 png-to-ico@2.1.8 pdfkit@0.15.0 svg-to-pdfkit@0.1.8

Steps:

    node trace.js  ../source/buildflow-logo-generated-2026-11-16.png <tmpDir>
    node export.js <tmpDir> <repoRoot>

- `trace.js` traces the PNG into `buildflow-mark.svg`, `buildflow-lockup.svg` and `buildflow-mark-icon.svg` (white-filled frame, used for favicons and app icons). Colours are forced to Navy `#092648` and Orange `#FF7900`.
- `export.js` writes the favicons, PWA icons, apple-touch icon, header PNGs, the 1024/2048 PNGs, the vector PDF and `public/manifest.webmanifest`.

Any visual change to the logo needs owner approval before export (see CLAUDE.md).
