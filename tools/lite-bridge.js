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
    if (!data || data.proto !== PROTO || typeof data.id !== "string") {
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
