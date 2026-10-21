# Owl Traffic Report

An unofficial, Florida Atlantic Owls-themed look at traffic on the roads around FAU's Boca Raton campus.

- **Data:** FDOT [Florida Traffic Online](https://tdaappsprod.dot.state.fl.us/fto/) public ArcGIS service (AADT layer + count stations), queried live in the browser. `data/*.json` is a snapshot used if the live service is down.
- **Map:** Leaflet with CARTO/OpenStreetMap tiles. **Charts:** Chart.js.
- **Photos:** Wikimedia Commons (credits in the page footer).

Static site, no build step. Run locally with `python3 -m http.server` and deploy the folder to Netlify.

Not affiliated with or endorsed by Florida Atlantic University. Owls marks are FAU trademarks.
