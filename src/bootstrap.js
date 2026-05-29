"use strict";

var BatchNotes;

function log(msg) {
    Zotero.debug("Batch Notes: " + msg);
}

function install() {
    log("Installed");
}

async function startup({ id, version, rootURI }) {
    log("Starting " + version);

    // Load main plugin code
    Services.scriptloader.loadSubScript(rootURI + "batch-notes.js");
    BatchNotes.init({ id, version, rootURI });
    BatchNotes.addToAllWindows();
    await BatchNotes.main();
}

function onMainWindowLoad({ window }) {
    BatchNotes.addToWindow(window);
}

function onMainWindowUnload({ window }) {
    BatchNotes.removeFromWindow(window);
}

function shutdown() {
    log("Shutting down");
    BatchNotes.removeFromAllWindows();
    BatchNotes = undefined;
}

function uninstall() {
    log("Uninstalled");
}
