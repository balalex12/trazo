// Runs inside the notebook site (JupyterLab), as the other end of excalidraw-app/notebook/protocol.ts: lets the Trazo
// app that embeds this page read the notebook that is open and add a cell to it. It speaks only to the page that
// embeds it, and only if that page is one of the origins below (the same list as `frame-ancestors`); anything else
// that embeds the site gets silence. tools/build-jupyterlite.mjs copies this file into the site and fills in the list.
(function () {
  "use strict";
  var PROTO = "trazo-notebook/1";
  var PARENTS = __TRAZO_PARENT_ORIGINS__;
  var MAX_SOURCE = 1000000;

  if (window.parent === window) {
    return; // not embedded
  }

  function parentOrigin() {
    var ancestors = window.location.ancestorOrigins;
    var origin = "";
    if (ancestors && ancestors.length) {
      origin = ancestors[0];
    } else if (document.referrer) {
      try {
        origin = new URL(document.referrer).origin;
      } catch (e) {
        origin = "";
      }
    }
    return PARENTS.indexOf(origin) >= 0 ? origin : null;
  }

  var origin = parentOrigin();
  if (!origin) {
    return;
  }

  function send(message) {
    message.proto = PROTO;
    window.parent.postMessage(message, origin);
  }

  /** the notebook in the active tab, or null (a file browser, a text file…) */
  function activeNotebook() {
    var app = window.jupyterapp;
    var widget = app && app.shell && app.shell.currentWidget;
    var ok =
      widget &&
      widget.context &&
      /\.ipynb$/.test(widget.context.path) &&
      widget.content &&
      widget.content.model &&
      widget.content.model.sharedModel;
    return ok ? widget : null;
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window.parent || event.origin !== origin) {
      return;
    }
    var data = event.data;
    if (!data || data.proto !== PROTO) {
      return;
    }
    if (data.type === "kernel-reply") {
      // the answer to something the `trazo` Python module asked: back down the comm it came from
      var comm = typeof data.commId === "string" ? comms[data.commId] : null;
      if (comm) {
        comm.send(data.data);
      }
      return;
    }
    if (typeof data.id !== "string") {
      return;
    }
    try {
      var widget = activeNotebook();
      if (!widget) {
        send({
          type: "error",
          id: data.id,
          message: "Open a notebook in the panel first.",
        });
      } else if (data.type === "get-notebook") {
        send({
          type: "notebook",
          id: data.id,
          path: widget.context.path,
          // the notebook as it is now, saved or not
          text: widget.context.model.toString(),
        });
      } else if (data.type === "insert-cell") {
        if (
          typeof data.source !== "string" ||
          data.source.length > MAX_SOURCE
        ) {
          throw new Error("That cell is too big.");
        }
        // a code cell, added at the end and NOT run: running it is up to you
        widget.content.model.sharedModel.addCell({
          cell_type: "code",
          source: data.source,
        });
        send({ type: "inserted", id: data.id, path: widget.context.path });
      }
    } catch (error) {
      send({
        type: "error",
        id: data.id,
        message: String((error && error.message) || error),
      });
    }
  });

  // --- the kernel side ----------------------------------------------------------------------------------------
  // The `trazo` Python module opens a comm named "trazo". What it sends is passed up to Trazo as it is (Trazo checks
  // it), and Trazo's answers go back down the same comm. Each notebook has its own kernel, so every open notebook is
  // hooked, and again whenever its kernel is restarted.
  var comms = {};
  var hooked = [];

  function hook(widget) {
    if (hooked.indexOf(widget) >= 0) {
      return;
    }
    hooked.push(widget);
    function attach() {
      var session = widget.sessionContext.session;
      var kernel = session && session.kernel;
      if (!kernel) {
        return;
      }
      kernel.registerCommTarget("trazo", function (comm, message) {
        comms[comm.commId] = comm;
        comm.onClose = function () {
          delete comms[comm.commId];
        };
        comm.onMsg = function (m) {
          send({ type: "kernel", commId: comm.commId, data: m.content.data });
        };
        if (message.content.data && message.content.data.op) {
          send({
            type: "kernel",
            commId: comm.commId,
            data: message.content.data,
          });
        }
      });
    }
    widget.sessionContext.ready.then(attach);
    widget.sessionContext.kernelChanged.connect(attach);
  }

  function notebooks() {
    var found = [];
    var app = window.jupyterapp;
    if (!app || !app.shell || !app.shell.widgets) {
      return found;
    }
    var it = app.shell.widgets("main");
    for (var w = it.next(); w && !w.done; w = it.next()) {
      var widget = w.value || w;
      if (
        widget &&
        widget.sessionContext &&
        widget.content &&
        widget.content.model &&
        widget.context &&
        /\.ipynb$/.test(widget.context.path)
      ) {
        found.push(widget);
      }
    }
    return found;
  }

  // --- what is running, and what the kernel holds ------------------------------------------------------------
  // JupyterLab does not announce "a cell started" in a way a page can subscribe to without its modules, so the open
  // notebook is looked at a few times a second and Trazo is told only when something changed.
  var lastRun = "";
  var wasRunning = false;
  var asking = false;

  var INTROSPECT = [
    "def _trazo_vars():",
    "    out = {}",
    "    for k, v in list(globals().items()):",
    "        if k.startswith('_') or len(out) >= 300:",
    "            continue",
    "        t = type(v)",
    "        mod = getattr(t, '__module__', '') or ''",
    "        try:",
    "            if (mod.startswith('pandas') or mod.startswith('geopandas') or mod.startswith('numpy')) and hasattr(v, 'shape'):",
    "                info = {'kind': t.__name__, 'shape': [int(n) for n in v.shape]}",
    "                if hasattr(v, 'columns'):",
    "                    info['columns'] = [str(c) for c in list(v.columns)[:60]]",
    "                out[k] = info",
    "            elif isinstance(v, (list, tuple, dict, set)):",
    "                out[k] = {'kind': t.__name__, 'length': len(v)}",
    "        except Exception:",
    "            pass",
    "    print(__import__('json').dumps(out))",
    "_trazo_vars()",
    "del _trazo_vars",
  ].join("\n");

  function introspect(widget) {
    var session = widget.sessionContext.session;
    var kernel = session && session.kernel;
    if (!kernel || asking) {
      return;
    }
    asking = true;
    var text = "";
    // not "silent": a silent execution would not send its output. Not stored in the history either.
    var future = kernel.requestExecute({
      code: INTROSPECT,
      store_history: false,
    });
    future.onIOPub = function (m) {
      if (m.header.msg_type === "stream" && m.content.name === "stdout") {
        text += m.content.text;
      }
    };
    future.done.then(
      function () {
        asking = false;
        try {
          var lines = text.trim().split("\n");
          send({ type: "vars", vars: JSON.parse(lines[lines.length - 1]) });
        } catch (e) {
          /* the kernel was busy or answered something else: the next run asks again */
        }
      },
      function () {
        asking = false;
      },
    );
  }

  function codeCells(widget) {
    var cells = widget.content.model.cells;
    var out = [];
    var ord = 0;
    for (var i = 0; i < cells.length; i++) {
      var cell = cells.get(i);
      if (cell.type !== "code") {
        continue;
      }
      ord++;
      out.push({
        ord: ord,
        count:
          typeof cell.executionCount === "number" ? cell.executionCount : null,
        state: cell.executionState === "running" ? "running" : "idle",
      });
    }
    return out;
  }

  setInterval(function () {
    var open = notebooks();
    open.forEach(hook);
    var widget = activeNotebook();
    if (!widget) {
      return;
    }
    var cells = codeCells(widget);
    var key = JSON.stringify(cells);
    var running = cells.some(function (c) {
      return c.state === "running";
    });
    if (key !== lastRun) {
      lastRun = key;
      send({ type: "run", cells: cells });
    }
    if (wasRunning && !running) {
      introspect(widget);
    }
    wasRunning = running;
  }, 300);

  // tell Trazo when JupyterLab is up
  (function wait(tries) {
    var app = window.jupyterapp;
    if (app && app.started) {
      app.started.then(function () {
        send({ type: "ready" });
      });
    } else if (tries > 0) {
      setTimeout(function () {
        wait(tries - 1);
      }, 250);
    }
  })(240);
})();
