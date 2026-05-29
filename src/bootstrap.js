"use strict";

var chromeHandle;
var winListener;

function log(msg) {
    Zotero.debug("Batch Notes: " + msg);
}

function install(data, reason) {
    log("Installed");
}

function startup({ id, version, resourceURI, rootURI }, reason) {
    log("Starting " + version + " from " + rootURI);

    return (async () => {
        await Zotero.initializationPromise;

        if (!rootURI) {
            rootURI = resourceURI.spec;
        }

        // Register chrome for prefs.xhtml chrome:// URL
        try {
            var aomStartup = Components.classes[
                "@mozilla.org/addons/addon-manager-startup;1"
            ].getService(Components.interfaces.amIAddonManagerStartup);
            var manifestURI = Services.io.newURI(rootURI + "manifest.json");
            chromeHandle = aomStartup.registerChrome(manifestURI, [
                ["content", "batch-obsidian", rootURI + "content/"],
            ]);
        } catch (e) {
            log("Chrome registration failed: " + e.message);
        }

        // Load main plugin code
        Services.scriptloader.loadSubScript(rootURI + "batch-notes.js");
        BatchNotes.init({ id, version, rootURI });
        BatchNotes.addToAllWindows();

        // Listen for windows opened after startup
        winListener = {
            observe: function (win, topic, data) {
                if (topic === "domwindowopened") {
                    win.addEventListener("load", function () {
                        if (win.ZoteroPane) {
                            BatchNotes.addToWindow(win);
                        } else {
                            var ci = win.setInterval(function () {
                                if (win.ZoteroPane) {
                                    win.clearInterval(ci);
                                    BatchNotes.addToWindow(win);
                                }
                            }, 200);
                        }
                    }, { once: true });
                }
            }
        };
        Services.ww.registerNotification(winListener);

        log("Startup complete");
    })();
}

function shutdown({ id, version, resourceURI, rootURI }, reason) {
    log("Shutting down");

    // Unregister window listener
    if (winListener) {
        try { Services.ww.unregisterNotification(winListener); } catch (e) {}
        winListener = null;
    }

    // Remove menus from all windows
    if (typeof BatchNotes !== "undefined" && BatchNotes.removeFromAllWindows) {
        BatchNotes.removeFromAllWindows();
    }

    // Unregister chrome
    if (chromeHandle) {
        try { chromeHandle.destruct(); } catch (e) {}
        chromeHandle = null;
    }

    BatchNotes = undefined;
}

function uninstall(data, reason) {
    log("Uninstalled");
}
