import { TypedEmitter } from "../utils";
import * as fs from "fs";
import * as path from "path";
import { useEffect } from "react";
import * as React from "react";
import classNames from "classnames";
import { UIContext } from "./maincomponents";
import { TabStrip } from "./commoncontrols";
import { showModal } from "./jsonsearch";
import VR360Viewer from "../libs/vr360viewer";
import { ScriptFS, ScriptOutput, ScriptState } from "../scriptrunner";


export type UIScriptFile = { name: string, data: Buffer | string };

export class UIScriptFS extends TypedEmitter<{ writefile: undefined }> implements ScriptFS {
	filesMap = new Map<string, UIScriptFile>();
	rootdirhandle: FileSystemDirectoryHandle | null = null;
	outdirhandles = new Map<string, FileSystemDirectoryHandle | null>();
	output: UIScriptOutput | null;

	constructor(output: UIScriptOutput | null) {
		super();
		this.output = output;
	}

	async mkDir(name: string) {
		this.outdirhandles.set(name, null);
		this.emit("writefile", undefined);
		this.output?.emit("writefile", undefined);
	}
	async writeFile(name: string, data: Buffer | string) {
		let fileentry: UIScriptFile = { name, data };
		if (this.filesMap.has(name)) {
			this.output?.log(`overwriting file "${name}"`);
			// let index = this.files.findIndex(q => q.name == name);
			// this.files[index] = fileentry;
		} else {
			// this.files.push(fileentry);
		}
		this.filesMap.set(name, fileentry);
		if (this.rootdirhandle) { await this.saveLocalFile(name, data); }
		this.emit("writefile", undefined);
		this.output?.emit("writefile", undefined);
	}
	readFileBuffer(name: string): Promise<Buffer> {
		throw new Error("not implemented");
	}
	readFileText(name: string): Promise<string> {
		throw new Error("not implemented");
	}
	readDir(name: string): Promise<string[]> {
		throw new Error("not implemented");
	}
	unlink(name: string): Promise<void> {
		throw new Error("not implemented");
	}

	async setSaveDirHandle(dir: FileSystemDirectoryHandle) {
		if (await dir.requestPermission() != "granted") { throw new Error("no permission"); }
		let retroactive = !this.rootdirhandle;
		this.rootdirhandle = dir;
		this.outdirhandles = new Map();
		this.outdirhandles.set("", dir);
		if (retroactive) {
			for (let [dir, handle] of this.outdirhandles.entries()) {
				if (!handle) { await this.mkdirLocal(dir.split("/")); }
			}
			await Promise.all([...this.filesMap.values()].map(q => this.saveLocalFile(q.name, q.data)));
		}
		this.output?.emit("statechange", undefined);
	}

	async mkdirLocal(path: string[]) {
		let dirname = path.join("/");
		let dir = this.outdirhandles.get(dirname);
		if (!dir) {
			dir = this.rootdirhandle!;
			for (let part of path) {
				dir = await dir.getDirectoryHandle(part, { create: true });
			}
			this.outdirhandles.set(dirname, dir);
		}
		return dir;
	}

	async saveLocalFile(filename: string, file: Buffer | string) {
		if (!this.rootdirhandle) { throw new Error("tried to save without dir handle"); }
		let parts = filename.split("/");
		let name = parts.splice(-1, 1)[0];
		let dir = await this.mkdirLocal(parts);
		let filehandle = await dir.getFileHandle(name, { create: true });
		let writable = await filehandle.createWritable({ keepExistingData: false });
		await writable.write(file);
		await writable.close();
	}
}

export class UIScriptOutput extends TypedEmitter<{ log: string, statechange: undefined, writefile: undefined }> implements ScriptOutput {
	state: ScriptState = "running";
	logs: string[] = [];
	outputui: HTMLElement | null = null;
	fs: Record<string, UIScriptFS>;

	log(...args: any[]) {
		let str = args.join(" ");
		this.logs.push(str);
		this.emit("log", str);
	}

	setState(state: ScriptState) {
		this.state = state;
		this.emit("statechange", undefined);
	}
	setUI(el: HTMLElement | null) {
		this.outputui = el;
		this.emit("statechange", undefined);
	}

	constructor() {
		super();
		this.fs = {};
	}

	makefs(name: string) {
		let fs = new UIScriptFS(this);
		this.fs[name] = fs;
		this.emit("statechange", undefined);
		return fs;
	}

	async run<ARGS extends any[], RET extends any>(fn: (output: ScriptOutput, ...args: [...ARGS]) => Promise<RET>, ...args: ARGS): Promise<RET | null> {
		try {
			return await fn(this, ...args);
		} catch (e) {
			console.warn(e);
			if (this.state != "canceled") {
				this.log(e);
				this.setState("error");
			}
			return null;
		} finally {
			if (this.state == "running") {
				this.setState("done");
			}
		}
	}
}

function forceUpdateReducer(i: number) { return i + 1; }
export function useForceUpdate() {
	const [, forceUpdate] = React.useReducer(forceUpdateReducer, 0);
	return forceUpdate;
}

export function useForceUpdateDebounce(delay = 50) {
	const forceUpdate = useForceUpdate();
	let ref = React.useRef(() => { });
	React.useMemo(() => {
		let timer = 0;
		let tick = () => {
			timer = 0;
			forceUpdate();
		}
		ref.current = () => {
			if (!timer) {
				timer = +setTimeout(tick, delay);
			}
		}
		return () => {
			clearTimeout(timer);
			timer = 0;
		}
	}, [forceUpdate, ref]);
	return ref.current;
}

export function VR360View(p: { img: string | ImageData | TexImageSource }) {
	let viewer = React.useRef<VR360Viewer | null>(null);
	if (!viewer.current) {
		viewer.current = new VR360Viewer(p.img);
		viewer.current.cnv.style.width = "100%";
		viewer.current.cnv.style.height = "100%";
	}

	let currentimg = React.useRef(p.img);
	if (p.img != currentimg.current) {
		viewer.current.setImage(p.img);
		currentimg.current = p.img;
	}

	React.useEffect(() => () => viewer.current?.free(), []);

	let wrapper = React.useRef<HTMLElement | null>(null);
	let ref = (el: HTMLElement | null) => {
		viewer.current?.cnv && el && el.appendChild(viewer.current?.cnv);
		wrapper.current = el;
	}

	return (
		<React.Fragment>
			<div>
				<input type="button" className="sub-btn" value="Fullscreen" onClick={() => wrapper.current?.requestFullscreen()} />
			</div>
			<div ref={ref} style={{ position: "relative", paddingBottom: "60%" }} />
		</React.Fragment>
	)
}

export function DomWrap(p: { el: HTMLElement | DocumentFragment | null | undefined, tagName?: "div" | "td" | "span" | "p", style?: React.CSSProperties, className?: string }) {
	let ref = (el: HTMLElement | null) => {
		p.el && el && el.replaceChildren(p.el);
	}
	let Tagname = p.tagName ?? "div";
	return <Tagname ref={ref} style={p.style} className={p.className} />;
}

export function OutputUI(p: { output?: UIScriptOutput | null, ctx: UIContext }) {
	let [tab, setTab] = React.useState<"console" | string>("console");

	let forceUpdate = useForceUpdateDebounce();
	React.useLayoutEffect(() => {
		p.output?.on("statechange", forceUpdate);
		p.output?.on("writefile", forceUpdate);
		() => {
			p.output?.off("statechange", forceUpdate);
			p.output?.off("writefile", forceUpdate);
		}
	}, [p.output]);

	if (!p.output) {
		return (
			<div>Waiting</div>
		);
	}

	let fstabmatch = tab.match(/^fs-(.*)$/);
	let selectedfs = fstabmatch && p.output && p.output.fs[fstabmatch[1]];

	let tabs = { console: "Console" };
	for (let fsname in p.output?.fs) { tabs["fs-" + fsname] = fsname; }

	return (
		<div>
			<div>
				Script state: {p.output.state}
				{p.output.state == "running" && <input type="button" className="sub-btn" value="cancel" onClick={e => p.output?.setState("canceled")} />}
			</div>
			{p.output.outputui && <input type="button" className="sub-btn" value="Script ui" onClick={e => showModal({ title: "Script output" }, <DomWrap el={p.output?.outputui} />)} />}
			<TabStrip value={tab} onChange={setTab as any} tabs={tabs} />
			{tab == "console" && <UIScriptConsole output={p.output} />}
			{selectedfs && <UIScriptFiles fs={selectedfs} ctx={p.ctx} />}
		</div>
	)
}

export function UIScriptFiles(p: { fs?: UIScriptFS | null, ctx: UIContext }) {
	const initialMaxlist = 4000;
	let [files, setFiles] = React.useState(p.fs?.filesMap);
	let [maxlist, setMaxlist] = React.useState(initialMaxlist);

	useEffect(() => {
		if (p.fs) {
			let debouncetimer = 0;
			setMaxlist(initialMaxlist);
			setFiles(p.fs.filesMap);
			let onchange = () => {
				if (!debouncetimer) {
					debouncetimer = +setTimeout(() => {
						setFiles(p.fs!.filesMap);
						debouncetimer = 0;
					}, 50);
				}
			}
			p.fs.on("writefile", onchange);
			return () => {
				if (debouncetimer) { clearTimeout(debouncetimer); }
				p.fs?.off("writefile", onchange);
			}
		}
	}, [p.fs]);

	let listkeydown = (e: React.KeyboardEvent) => {
		if (p.fs && p.ctx.openedfile && e.key == "ArrowDown" || e.key == "ArrowUp") {
			e.preventDefault();
			//bit of a yikes, map behaves as a single linked list and i'm trying to not
			//piss of the god of JIT by writing a custom iterator
			let previous: UIScriptFile | null = null;
			let match: UIScriptFile | null = null;
			let grabnext = false;
			for (let file of p.fs!.filesMap.values()) {
				if (grabnext) {
					match = file;
					break;
				} else if (file == p.ctx.openedfile) {
					if (e.key == "ArrowUp") {
						match = previous;
						break;
					} else {
						grabnext = true;
					}
				}
				previous = file;
			}
			if (match) {
				p.ctx.openFile(match);
			}
		}
	}

	//expose the fs to script, but make sure we don't leak it after it's gone from ui
	useEffect(() => {
		globalThis.scriptfs = p.fs;
		return () => {
			globalThis.scriptfs = null;
		}
	})

	if (!files) {
		return <div />;
	}
	else {
		let filelist: React.ReactNode[] = [];
		for (let q of files.values()) {
			if (filelist.length > maxlist) { break; }
			filelist.push(
				<div key={q.name} onClick={e => p.ctx.openFile(q)} style={q == p.ctx.openedfile ? { background: "black" } : undefined}>{q.name}</div>
			);
		}

		return (
			<div>
				{p.fs && !p.fs.rootdirhandle && <input type="button" className="sub-btn" value={"Save files " + p.fs.filesMap.size} onClick={async e => p.fs?.setSaveDirHandle(await showDirectoryPicker({}))} />}
				{p.fs?.rootdirhandle && <div>Saved files to disk: {p.fs.filesMap.size}</div>}
				{files.size > maxlist && <div>Only showing first {maxlist} files</div>}
				<div tabIndex={0} onKeyDownCapture={listkeydown}>
					{filelist}
					{files.size > maxlist && <input type="button" className="sub-btn" onClick={e => setMaxlist(maxlist + 4000)} value={`Show more (${maxlist}/${files.size})`} />}
				</div>
			</div>
		);
	}
}

export function UIScriptConsole(p: { output?: UIScriptOutput | null }) {
	let [el, setEl] = React.useState<HTMLDivElement | null>(null);

	useEffect(() => {
		if (el && p.output) {
			let onlog = (e: string) => {
				let line = document.createElement("div");
				line.innerText = e;
				el!.appendChild(line);
			}
			p.output.on("log", onlog);
			p.output.logs.forEach(onlog);
			return () => {
				p.output!.off("log", onlog);
				el!.innerHTML = "";
			}
		}
	}, [p.output, el]);

	return (
		<div ref={setEl} />
	);
}
