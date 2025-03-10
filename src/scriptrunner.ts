import path from "path";
import fs from "fs";

export type ScriptState = "running" | "canceled" | "error" | "done";

export interface ScriptOutput {
    state: ScriptState;
    log(...args: any[]): void;
    setUI(ui: HTMLElement | null): void;
    setState(state: ScriptState): void;
    run<ARGS extends any[], RET extends any>(fn: (output: ScriptOutput, ...args: [...ARGS]) => Promise<RET>, ...args: ARGS): Promise<RET | null>;
}

export interface ScriptFS {
    mkDir(name: string): Promise<any>;
    writeFile(name: string, data: Buffer | string): Promise<void>;
    readFileText(name: string): Promise<string>,
    readFileBuffer(name: string): Promise<Buffer>,
    readDir(name: string): Promise<string[]>,
    unlink(name: string): Promise<void>
}

export class CLIScriptFS implements ScriptFS {
    dir: string;
    constructor(dir: string) {
        this.dir = path.resolve(dir);
        if (dir) { fs.mkdirSync(dir, { recursive: true }); }
    }
    mkDir(name: string) {
        return fs.promises.mkdir(path.resolve(this.dir, name), { recursive: true });
    }
    writeFile(name: string, data: Buffer | string) {
        return fs.promises.writeFile(path.resolve(this.dir, name), data);
    }
    readFileBuffer(name: string) {
        return fs.promises.readFile(path.resolve(this.dir, name));
    }
    readFileText(name: string) {
        return fs.promises.readFile(path.resolve(this.dir, name), "utf-8");
    }
    readDir(name: string): Promise<string[]> {
        return fs.promises.readdir(path.resolve(this.dir, name));
    }
    unlink(name: string) {
        return fs.promises.unlink(path.resolve(this.dir, name));
    }
}

export class CLIScriptOutput implements ScriptOutput {
    state: ScriptState = "running";

    //bind instead of call so the original call site is retained while debugging
    log = console.log.bind(console);

    setUI(ui: HTMLElement | null) {
        if (ui && typeof document != "undefined") {
            document.body.appendChild(ui)
        }
    }

    setState(state: ScriptState) {
        this.state = state;
    }

    async run<ARGS extends any[], RET extends any>(fn: (output: ScriptOutput, ...args: ARGS) => Promise<RET>, ...args: ARGS): Promise<RET | null> {
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