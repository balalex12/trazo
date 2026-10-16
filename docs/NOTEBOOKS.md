# Python notebooks in the browser

Trazo can open **JupyterLite**: Jupyter notebooks whose Python (with pandas, NumPy, SciPy, scikit-learn, matplotlib, GeoPandas, Shapely, rasterio, DuckDB…) runs **inside the browser tab**, through WebAssembly (Pyodide). There is no Python server, nothing is executed on your computer outside the tab's sandbox, and nothing is sent anywhere.

It is optional and separate from the app: a small static site that you build once and that Docker serves on `127.0.0.1:3002`.

## Set it up

```
node tools/build-jupyterlite.mjs          # once: about 230 MB, needs python3, tar (with bzip2) and node 18+
docker compose --profile lite up -d       # then open http://127.0.0.1:3002
```

Then in Trazo: **Menu → Python notebook…** (or the command palette, or the **Python notebook…** button of **Import to diagram**). It opens in a new tab with two starter notebooks, `welcome.ipynb` and `churn.ipynb`.

The first start of a notebook takes some seconds (Pyodide loads), then it is quick. Files you create live in your browser (IndexedDB) for that site: use **File → Download** to keep a notebook as an `.ipynb`.

![A notebook running in the browser: a table, an aggregation and a matplotlib chart](media/v5-notebooks-jupyterlite.png)

## From a notebook to a diagram

Download the `.ipynb` (**File → Download**) and choose it in **Import to diagram**: Trazo draws where the data goes (reads, tables, models, files written). See [IMPORT.md](IMPORT.md#jupyter-notebook). Trazo reads the notebook as text; it does not run it.

## Local-first: how it stays offline

- `tools/build-jupyterlite.mjs` downloads the official Pyodide distribution **once, on your machine, at build time** (a pinned version, checked against a pinned SHA-256) and keeps the core plus a short list of packages and everything they depend on (all pure-Python packages are kept, about 35 MB, so the kernel never needs PyPI). It builds JupyterLite from pinned pip packages in a throwaway virtualenv inside `assets/jupyterlite-work/`. Nothing is committed (`assets/jupyterlite/` and `assets/jupyterlite-work/` are git-ignored).
- After that the site makes **no network request**. It was checked in a headless browser, requests logged, with the real Content-Security-Policy: none, including running pandas, scikit-learn and matplotlib.
- The container's policy (`deploy/nginx/lite.conf`, plus `_csp.conf` written by the build) allows no origin except itself and `connect-src 'self'`, so a notebook cannot fetch from the network even if it tries. `'wasm-unsafe-eval'` is what WebAssembly needs and `'unsafe-eval'` is what JupyterLab's own code loader needs; both are the cost of running Python in the page. The inline scripts of the JupyterLite pages are allowed by hash, not by `'unsafe-inline'`.
- `pip install` / `%pip install` inside a notebook reads from the packages bundled in the site only. A package that is not there cannot be installed (and would need the network, which is blocked). To add one that Pyodide ships, put its name in `PACKAGES` in `tools/build-jupyterlite.mjs` and rebuild.

## What is and is not there

Included: `micropip`, IPython, NumPy, pandas, SciPy, matplotlib, scikit-learn, statsmodels, NetworkX, SymPy, Pillow, lxml, BeautifulSoup, PyYAML, pydantic, tqdm, joblib, xarray, PyArrow, SQLAlchemy, DuckDB, Shapely, pyproj, Fiona, GeoPandas, rasterio, h5py, netCDF4, and every pure-Python package of Pyodide.

Not possible in the browser sandbox: GDAL command-line tools, FME, PyTorch/TensorFlow, anything that needs a socket or a server, and large datasets (the tab has a few GB of memory at most). Real files on your disk are not visible to the notebook: upload them in the file browser first (they stay in the tab).

## Moving the site

The app opens `http://<same host>:3002/lab/index.html`. For another port or a domain, set `VITE_APP_JUPYTERLITE_ORIGIN` when building the app, and update `frame-ancestors` in `tools/build-jupyterlite.mjs` if you want the notebook embedded by an app on another origin.

## Updating Pyodide or JupyterLite

Versions are pinned in `tools/build-jupyterlite.mjs` (`PYODIDE_VERSION`, `PYODIDE_SHA256`, `PIP_PINS`). Pyodide must be the version the JupyterLite kernel was built for (the kernel's bundled default URL names it). Change them together, rebuild and run a notebook before committing.
