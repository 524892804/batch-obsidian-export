/* Batch Notes to Obsidian — Zotero 7 Plugin
 *
 * Three priorities:
 *   P0 — Fix ZotLit batch export: chunked URLs + ProgressWindow + Direct fallback
 *   P1 — Fix Translate for Zotero startup race condition
 *   P2 — Inject menu into ZotLit's submenu to reduce clutter
 */

"use strict";

var BatchNotes = {
	_initialized: false,
	_addedIDs: [],

	/* ── Lifecycle ─────────────────────────────── */

	init({ id, version, rootURI }) {
		if (this._initialized) return;
		this._id = id;
		this._version = version;
		this._rootURI = rootURI;
		this._initialized = true;
		this.log("initialized v" + version);

		// P1: Fix Translate for Zotero startup race condition
		this._fixTranslatePlugin();
	},

	log(msg) {
		Zotero.debug("BatchNotes: " + msg);
	},

	/* ── P1: Fix Translate for Zotero ─────────── */

	_fixTranslatePlugin() {
		try {
			// Check if Translate's hook exists but is disconnected
			if (typeof Zotero.PDFTranslate !== "undefined" &&
			    Zotero.PDFTranslate.hooks &&
			    typeof Zotero.PDFTranslate.hooks.onMainWindowLoad === "function") {

				this.log("Translate plugin detected, re-hooking reader windows");

				// Re-apply hook to all open windows
				for (let win of Zotero.getMainWindows()) {
					try {
						Zotero.PDFTranslate.hooks.onMainWindowLoad(win);
					} catch (e) {
						this.log("Translate re-hook window error: " + e.message);
					}
				}

				// Also patch ZotLit's reader hook to preserve Translate's hook
				this._patchReaderToPreserveTranslate();
				this.log("Translate fix applied");
			} else {
				this.log("Translate not detected or no hooks available");
			}
		} catch (e) {
			this.log("Translate fix error: " + e.message);
		}
	},

	_patchReaderToPreserveTranslate() {
		// ZotLit replaces Reader.prototype._initIframeWindow
		// We wrap it so Translate's hook survives
		try {
			let Reader = Zotero.Reader;
			if (!Reader || !Reader.prototype) return;

			let origInit = Reader.prototype._initIframeWindow;
			if (!origInit) return;

			let self = this;
			Reader.prototype._initIframeWindow = async function() {
				let result = await origInit.apply(this, arguments);
				// After ZotLit's init completes, re-fire Translate's hook
				try {
					if (typeof Zotero.PDFTranslate !== "undefined" &&
					    Zotero.PDFTranslate.hooks &&
					    typeof Zotero.PDFTranslate.hooks.onMainWindowLoad === "function") {
						let mainWin = Zotero.getMainWindows()[0];
						if (mainWin) {
							Zotero.PDFTranslate.hooks.onMainWindowLoad(mainWin);
						}
					}
				} catch (e) {
					self.log("Post-init Translate re-hook: " + e.message);
				}
				return result;
			};
			this.log("Reader patched to preserve Translate hooks");
		} catch (e) {
			this.log("Reader patch error: " + e.message);
		}
	},

	/* ── Window Management ─────────────────────── */

	addToAllWindows() {
		for (let win of Zotero.getMainWindows()) {
			if (win.ZoteroPane) this.addToWindow(win);
		}
	},

	addToWindow(win) {
		try {
			let doc = win.document;
			let menu = doc.getElementById("zotero-itemmenu");
			if (!menu) {
				this.log("#zotero-itemmenu not found");
				return;
			}

			// P2: Inject into ZotLit's "Obsidian Actions" submenu if it exists
			if (this._addToZotLitSubmenu(win, doc)) {
				this.log("injected into ZotLit submenu");
				return;
			}

			// Fallback: add standalone menu item
			if (doc.getElementById("batch-obsidian-menuitem")) return;

			let sep = doc.createElement("menuseparator");
			sep.id = "batch-obsidian-sep-fallback";
			menu.appendChild(sep);
			this._addedIDs.push(sep.id);

			let mi = doc.createElement("menuitem");
			mi.id = "batch-obsidian-menuitem";
			mi.setAttribute("label", "Batch Export to Obsidian\u2026");
			mi.addEventListener("command", () => this.doBatchExport(win));
			menu.appendChild(mi);
			this._addedIDs.push(mi.id);

			this.log("standalone menu items added (ZotLit submenu not found)");
		} catch (e) {
			this.log("addToWindow error: " + e.message);
		}
	},

	/* ── P2: Inject into ZotLit's submenu ──────── */

	_addToZotLitSubmenu(win, doc) {
		try {
			// Find ZotLit's "Obsidian Actions" menu inside #zotero-itemmenu
			let menus = doc.querySelectorAll("#zotero-itemmenu > menu");
			let targetPopup = null;
			for (let m of menus) {
				let label = m.getAttribute("label") || "";
				if (label.includes("Obsidian Actions") || label.includes("Obsidian Note")) {
					targetPopup = m.querySelector("menupopup");
					break;
				}
			}
			if (!targetPopup) return false;
			if (doc.getElementById("batch-obsidian-menuitem")) {
				// Already injected in a previous addToWindow call
				return true;
			}

			// Add separator inside ZotLit's submenu
			let sep = doc.createElement("menuseparator");
			sep.id = "batch-obsidian-sep";
			targetPopup.appendChild(sep);
			this._addedIDs.push(sep.id);

			// Add our menu item inside ZotLit's submenu
			let mi = doc.createElement("menuitem");
			mi.id = "batch-obsidian-menuitem";
			mi.setAttribute("label", "Batch Export All to Obsidian\u2026");
			mi.addEventListener("command", () => this.doBatchExport(win));
			targetPopup.appendChild(mi);
			this._addedIDs.push(mi.id);

			this.log("injected into ZotLit submenu");
			return true;
		} catch (e) {
			this.log("inject into ZotLit submenu failed: " + e.message);
			return false;
		}
	},

	removeFromWindow(win) {
		let doc = win.document;
		for (let id of this._addedIDs) {
			let el = doc.getElementById(id);
			if (el) el.remove();
		}
	},

	removeFromAllWindows() {
		for (let win of Zotero.getMainWindows()) {
			if (win.ZoteroPane) this.removeFromWindow(win);
		}
	},

	/* ── Preferences ─────────────────────────────── */

	_pref(key) {
		try {
			return Zotero.Prefs.get("extensions.batch-obsidian-export." + key, true);
		} catch (e) {
			return null;
		}
	},

	/* ── P0: Core Export Entry Point ───────────── */

	async doBatchExport(win) {
		let pane = Zotero.getActiveZoteroPane();
		let items = pane ? pane.getSelectedItems() : [];

		if (!items || items.length === 0) {
			win.alert("请先选择要导出的文献。\n\nPlease select items to export.");
			return;
		}

		items = items.filter(i => i.isRegularItem());
		let total = items.length;

		if (total === 0) {
			win.alert("选中的条目中没有有效文献。\n\nNo valid items selected.");
			return;
		}

		let mode = this._pref("exportMode") || "auto";

		// P0: Try ZotLit first, capture results for fallback
		let zotlitSuccess = false;
		let failedItems = [];

		if (mode === "zotlit" || (mode === "auto" && this._zotlitAvailable())) {
			failedItems = await this._exportViaZotLit(items, win);
			zotlitSuccess = failedItems.length === 0;
		}

		// P0: Direct mode fallback for failures
		if (!zotlitSuccess && failedItems.length > 0) {
			let vault = this._pref("vault-path");
			if (vault) {
				let retry = win.confirm(
					"ZotLit 导出了 " + (total - failedItems.length) + "/" + total + " 篇。\n" +
					"剩余 " + failedItems.length + " 篇是否用 Direct 模式重试？\n\n" +
					"ZotLit exported " + (total - failedItems.length) + "/" + total + ".\n" +
					"Retry remaining " + failedItems.length + " via Direct mode?"
				);
				if (retry) {
					await this._exportDirect(failedItems, win);
				}
			} else {
				win.alert(
					"ZotLit 完成，" + failedItems.length + " 篇未导出。\n" +
					"如需 Direct 兜底，请在设置中配置库路径。\n\n" +
					"ZotLit finished, " + failedItems.length + " items not exported.\n" +
					"Configure vault path in settings for Direct fallback."
				);
			}
		}

		// Direct as primary mode
		if ((mode === "direct" || (mode === "auto" && !this._zotlitAvailable())) && !zotlitSuccess) {
			let vault = this._pref("vault-path");
			if (vault) {
				await this._exportDirect(items, win);
			} else if (this._zotlitAvailable()) {
				// Shouldn't reach here if auto mode, but just in case
			} else {
				win.alert(
					"请先在插件设置中配置 Obsidian 库路径。\n\n" +
					"Please configure your Obsidian vault path in Preferences."
				);
			}
		}
	},

	/* ─── ZotLit 检测 ──────────────────────────── */

	_zotlitAvailable() {
		// Method 1: via chrome import
		try {
			let ns = {};
			try {
				Components.utils.import("chrome://zotero-obsidian-note/content/bootstrap.js", ns);
				this.log("ZotLit detected via chrome import");
				return true;
			} catch (e) {}
		} catch (e) {}

		// Method 2: check menu items
		try {
			for (let win of Zotero.getMainWindows()) {
				if (!win.document) continue;
				let items = win.document.querySelectorAll("#zotero-itemmenu menuitem, #zotero-itemmenu menu");
				for (let mi of items) {
					let label = mi.getAttribute("label") || "";
					if (label.includes("Obsidian")) {
						this.log("ZotLit detected via menu");
						return true;
					}
				}
			}
		} catch (e) {}

		return false;
	},

	/* ─── P0: Mode 1 — ZotLit URL Scheme ──────── */

	async _exportViaZotLit(items, win) {
		let total = items.length;
		this.log("Exporting " + total + " items via ZotLit URL scheme");

		let pw = new Zotero.ProgressWindow({ closeOnClick: true });
		pw.changeHeadline("Export via ZotLit (0/" + total + ")");
		pw.show();

		let chunkSize = parseInt(this._pref("chunkSize") || "15", 10);
		if (chunkSize < 1) chunkSize = 15;
		if (chunkSize > 50) chunkSize = 50;

		let chunks = [];
		for (let i = 0; i < items.length; i += chunkSize) {
			chunks.push(items.slice(i, i + chunkSize));
		}

		let sent = 0;
		let failedItems = [];

		for (let ci = 0; ci < chunks.length; ci++) {
			let chunk = chunks[ci];

			try {
				let encoded = chunk.map(item => this._encodeItem(item));
				let url = this._buildZotLitUrl("export", encoded);

				// Log URL length for debugging
				this.log("Chunk " + (ci + 1) + " URL length: " + url.length + " chars");

				Zotero.launchURL(url);
				sent += chunk.length;

				let line = pw.addProgressLine(
					"Chunk " + (ci + 1) + "/" + chunks.length +
					" (" + sent + "/" + total + " sent)"
				);
				pw.updateLine(line);

				await this._sleep(500); // Give Obsidian URL handler time
			} catch (e) {
				this.log("Chunk " + ci + " error: " + e.message);
				failedItems.push(...chunk);
			}
		}

		if (failedItems.length === 0) {
			pw.changeHeadline("All " + total + " sent to ZotLit");
			pw.addProgressLine("Check Obsidian for results.");
		} else {
			pw.changeHeadline(sent + "/" + total + " sent, " + failedItems.length + " failed");
			pw.addProgressLine(failedItems.length + " items failed — offering Direct fallback");
		}

		this.log("ZotLit export done: " + sent + "/" + total + " sent, "
			+ failedItems.length + " failed");

		return failedItems; // Return failed items for fallback
	},

	_encodeItem(item) {
		let data = { key: item.key, id: item.id, libraryID: item.libraryID };
		try {
			if (item.library && item.library.isGroup) {
				data.groupID = item.library.groupID;
			}
		} catch (e) {}
		return data;
	},

	_buildZotLitUrl(action, itemArray) {
		let parts = [];
		parts.push("arrayFormat=index");
		parts.push("version=1.0.0");
		parts.push("type=item");
		itemArray.forEach((item, idx) => {
			parts.push("items[" + idx + "]=" + encodeURIComponent(JSON.stringify(item)));
		});
		return "obsidian://zotero/" + action + "?" + parts.join("&");
	},

	_sleep(ms) {
		return new Promise(resolve => {
			let win = Zotero.getMainWindows()[0];
			if (win) win.setTimeout(resolve, ms);
			else setTimeout(resolve, ms);
		});
	},

	/* ─── P0: Mode 2 — Direct Export ──────────── */

	async _exportDirect(items, win) {
		let total = items.length;
		let vaultPath = this._pref("vaultPath");
		let notesDir = this._pref("notesDir") || "02-Reading/mdnotes";
		let conflictMode = this._pref("conflictAction") || "overwrite";

		let outDir = vaultPath.replace(/\\$/, "") + "/" +
			notesDir.replace(/\\/g, "/").replace(/^\/|\/$/g, "");

		this.log("Direct export to: " + outDir);

		// Verify vault path exists
		let vaultDir = new FileUtils.File(vaultPath);
		if (!vaultDir.exists()) {
			win.alert(
				"Obsidian 库路径不存在：\n" + vaultPath + "\n\n" +
				"Vault path does not exist. Please check Preferences."
			);
			return;
		}

		let pw = new Zotero.ProgressWindow({ closeOnClick: true });
		pw.changeHeadline("Exporting to " + notesDir + " (0/" + total + ")");
		pw.show();

		let created = 0;
		let skipped = 0;
		let errors = [];

		for (let i = 0; i < total; i++) {
			try {
				let item = items[i];
				let citekey = this._getCitekey(item);
				let safeName = this._sanitizeFilename(citekey || item.key);
				let filename = safeName + ".md";
				let filePath = outDir + "/" + filename;

				let file = new FileUtils.File(filePath);
				if (file.exists()) {
					if (conflictMode === "skip") {
						skipped++;
						let line = pw.addProgressLine(
							"[" + (i + 1) + "/" + total + "] SKIP: " + filename
						);
						pw.updateLine(line);
						continue;
					} else if (conflictMode === "rename") {
						let counter = 1;
						do {
							filePath = outDir + "/" + safeName + "_" + counter + ".md";
							file = new FileUtils.File(filePath);
							counter++;
						} while (file.exists());
					}
				}

				let content = await this._renderItem(item);
				this._writeFile(file, content);

				created++;
				let line = pw.addProgressLine(
					"[" + (i + 1) + "/" + total + "] " + filename
				);
				pw.updateLine(line);
			} catch (e) {
				this.log("Export error item " + i + ": " + e.message);
				errors.push("Item " + (i + 1) + ": " + e.message);
			}
		}

		pw.changeHeadline("Done: " + created + " created, " + skipped + " skipped");

		let msg = "Batch export complete!\n\n";
		msg += "Total: " + total + "\n";
		msg += "Created: " + created + "\n";
		msg += "Skipped: " + skipped + "\n";
		if (errors.length > 0) msg += "Errors: " + errors.length + "\n";

		this.log("Direct export: " + created + " created, " + skipped + " skipped, "
			+ errors.length + " errors");
	},

	_sanitizeFilename(name) {
		// Remove characters illegal in Windows filenames
		return String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim();
	},

	_writeFile(file, content) {
		try {
			file.parent.create(Components.interfaces.nsIFile.DIRECTORY_TYPE, 0o755);
		} catch (e) {}

		let stream = Components.classes[
			"@mozilla.org/network/file-output-stream;1"
		].createInstance(Components.interfaces.nsIFileOutputStream);
		stream.init(file, 0x02 | 0x08 | 0x20, 0o666, 0);

		let converter = Components.classes[
			"@mozilla.org/intl/converter-output-stream;1"
		].createInstance(Components.interfaces.nsIConverterOutputStream);
		converter.init(stream, "UTF-8");
		converter.writeString(content);
		converter.close();
	},

	_getCitekey(item) {
		// Better BibTeX stores citekey in extra field
		try {
			let extra = item.getField("extra");
			if (extra) {
				let m = extra.match(/(?:Citation Key|Citekey):\s*(\S+)/i);
				if (m) return m[1];
			}
		} catch (e) {}
		return null;
	},

	async _renderItem(item) {
		let templatePath = this._pref("templatePath");
		if (templatePath) {
			try {
				let vaultPath = this._pref("vaultPath");
				let fullPath = vaultPath.replace(/\\$/, "") + "/" +
					templatePath.replace(/^\/+/, "");
				let file = new FileUtils.File(fullPath);
				if (file.exists()) {
					let content = this._readFile(file);
					let rendered = this._applyTemplate(content, item);
					if (rendered) return rendered;
				}
			} catch (e) {
				this.log("Template load failed, using default: " + e.message);
			}
		}
		return this._defaultTemplate(item);
	},

	_readFile(file) {
		let stream = Components.classes[
			"@mozilla.org/network/file-input-stream;1"
		].createInstance(Components.interfaces.nsIFileInputStream);
		stream.init(file, 0x01, 0o444, 0);

		let converter = Components.classes[
			"@mozilla.org/intl/converter-input-stream;1"
		].createInstance(Components.interfaces.nsIConverterInputStream);
		converter.init(stream, "UTF-8");

		let data = "";
		let buffer = {};
		while (converter.readString(0x1000, buffer)) {
			data += buffer.value;
			if (buffer.value.length === 0) break;
		}
		converter.close();
		return data;
	},

	_escapeYAML(s) {
		if (!s) return "";
		return String(s).replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "");
	},

	_safeStr(v) {
		return v !== null && v !== undefined ? String(v) : "";
	},

	/* ── Default Template ───────────────────────── */

	_defaultTemplate(item) {
		let title  = this._safeStr(item.getField("title"));
		let date   = this._safeStr(item.getField("date"));
		let year   = (date.match(/\d{4}/) || [""])[0];
		let journal = this._safeStr(item.getField("publicationTitle")) ||
		              this._safeStr(item.getField("journal")) || "";
		let doi    = this._safeStr(item.getField("DOI"));
		let vol    = this._safeStr(item.getField("volume"));
		let iss    = this._safeStr(item.getField("issue"));
		let pages  = this._safeStr(item.getField("pages"));
		let abst   = this._safeStr(item.getField("abstractNote"));
		let url    = this._safeStr(item.getField("url"));
		let extra  = this._safeStr(item.getField("extra"));
		let citekey = this._getCitekey(item);

		let creators = [];
		try { creators = item.getCreators(); } catch (e) {}
		let authors = creators
			.filter(c => c.creatorType === "author")
			.map(c => (c.firstName || "") + " " + (c.lastName || ""))
			.map(n => n.trim())
			.filter(n => n)
			.join("; ");

		let tags = [];
		try { tags = item.getTags().map(t => t.tag); } catch (e) {}

		let jcrMatch = extra.match(/JCR[_\s]*(?:分区|Quartile)[:\s]*(\S+)/i);
		let jcr = jcrMatch ? jcrMatch[1] : "";
		let ifMatch = extra.match(/[影响因子Impact Factor]+[:\s]*([\d.]+)/i);
		let impactFactor = ifMatch ? ifMatch[1] : "";

		let zoteroURI = "zotero://select/items/" +
			(item.libraryID || 1) + "_" + item.key;

		// YAML frontmatter
		let front = ["---"];
		front.push('title: "' + this._escapeYAML(title) + '"');
		if (authors) {
			let authorArray = authors.split("; ").map(a =>
				'"' + this._escapeYAML(a) + '"'
			).join(", ");
			front.push("author: [" + authorArray + "]");
		}
		if (journal) front.push('journal: "' + this._escapeYAML(journal) + '"');
		if (year)    front.push("year: " + year);
		if (vol)     front.push('volume: "' + this._escapeYAML(vol) + '"');
		if (iss)     front.push('issue: "' + this._escapeYAML(iss) + '"');
		if (pages)   front.push('pages: "' + this._escapeYAML(pages) + '"');
		if (doi)     front.push('doi: "' + this._escapeYAML(doi) + '"');
		if (url)     front.push('url: "' + this._escapeYAML(url) + '"');
		if (citekey) front.push('citekey: "' + this._escapeYAML(citekey) + '"');
		if (jcr)     front.push('jcr_quartile: "' + this._escapeYAML(jcr) + '"');
		if (impactFactor) front.push("impact_factor: " + impactFactor);
		front.push("date: " + (year || new Date().getFullYear()));
		front.push('zotero: "' + this._escapeYAML(zoteroURI) + '"');
		if (tags.length) {
			front.push("tags: [" +
				tags.map(t => '"' + this._escapeYAML(t) + '"').join(", ") +
			"]");
		}
		front.push("---\n");

		// Body
		let body = [];
		body.push("# " + title + "\n");
		if (authors) body.push("**" + authors + "**  \n");
		body.push("");

		if (journal) {
			let jl = "*" + journal + "*";
			if (year) jl += ", " + year;
			if (vol) jl += ", " + vol;
			if (iss) jl += "(" + iss + ")";
			if (pages) jl += ", " + pages;
			if (doi) jl += ". DOI: " + doi;
			body.push(jl + "  \n");
			body.push("");
		}

		if (abst) {
			body.push("## Abstract\n");
			body.push(abst + "\n");
		}

		body.push("## Key Findings\n");
		body.push("> *What are the 2-3 most important findings?*\n");
		body.push("## Quotable Data\n");
		body.push("> *Include data/statistics worth citing*\n");
		body.push("## Insights\n");
		body.push("## Limitations\n");
		body.push("---\n");
		body.push("[View in Zotero](" + zoteroURI + ")\n");

		return front.join("\n") + body.join("\n");
	},

	/* ── Simple Template Engine ─────────────────── */

	_applyTemplate(tpl, item) {
		let vars = {
			title:          this._safeStr(item.getField("title")),
			authors:        this._formatAuthors(item),
			journal:        this._safeStr(item.getField("publicationTitle")),
			year:           (this._safeStr(item.getField("date")).match(/\d{4}/) || [""])[0],
			doi:            this._safeStr(item.getField("DOI")),
			abstract:       this._safeStr(item.getField("abstractNote")),
			url:            this._safeStr(item.getField("url")),
			volume:         this._safeStr(item.getField("volume")),
			issue:          this._safeStr(item.getField("issue")),
			pages:          this._safeStr(item.getField("pages")),
			publisher:      this._safeStr(item.getField("publisher")),
			place:          this._safeStr(item.getField("place")),
			isbn:           this._safeStr(item.getField("ISBN")),
			issn:           this._safeStr(item.getField("ISSN")),
			language:       this._safeStr(item.getField("language")),
			extra:          this._safeStr(item.getField("extra")),
			citekey:        this._getCitekey(item) || item.key,
			zoteroURI:      "zotero://select/items/" +
			                (item.libraryID || 1) + "_" + item.key,
		};

		return tpl.replace(/\{\{(\w+)\}\}/g, (m, key) =>
			Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : m
		);
	},

	_formatAuthors(item) {
		try {
			return item.getCreators()
				.filter(c => c.creatorType === "author")
				.map(c => (c.firstName || "") + " " + (c.lastName || ""))
				.map(n => n.trim()).filter(n => n)
				.join("; ");
		} catch (e) {
			return "";
		}
	}
};
