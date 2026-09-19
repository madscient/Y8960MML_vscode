import { spawn, type ChildProcess } from "node:child_process";
import * as path from "node:path";

export interface PlayRequest {
  playerPath: string;
  sequence: string;
  adpcm: string | undefined;
  tick: number | undefined;
}

export interface PlayEnd {
  /** true when stop() ended it */
  stopped: boolean;
  exitCode: number | null;
  stderr: string;
}

/**
 * One y8960player child at a time. There is no protocol with the player: it
 * plays and exits, and stopping it means ending the process.
 */
export class Player {
  private proc: ChildProcess | undefined;
  private stopping = false;

  get playing(): boolean {
    return this.proc !== undefined;
  }

  /**
   * Resolves once the process has started; `onEnd` fires when it exits.
   * Rejects with the spawn error (ENOENT when the player is not found).
   */
  start(req: PlayRequest, onEnd: (end: PlayEnd) => void): Promise<void> {
    this.stop();
    const args = [path.basename(req.sequence)];
    if (req.adpcm !== undefined) {
      args.push("--adpcm", path.basename(req.adpcm));
    }
    if (req.tick !== undefined) {
      args.push("--tick", String(req.tick));
    }

    return new Promise((resolve, reject) => {
      // Run from the outputs' folder with bare names, as y8mmlc is: whether the
      // player takes arguments in the ANSI code page has not been tried.
      const proc = spawn(req.playerPath, args, {
        cwd: path.dirname(req.sequence),
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
      });
      let stderr = "";
      proc.stderr!.setEncoding("utf8");
      proc.stderr!.on("data", (s: string) => (stderr += s));

      proc.once("spawn", () => {
        this.proc = proc;
        this.stopping = false;
        resolve();
      });
      proc.once("error", (err) => {
        if (this.proc !== proc) {
          reject(err);
        }
      });
      proc.once("exit", (code) => {
        if (this.proc !== proc) {
          return;
        }
        const stopped = this.stopping;
        this.proc = undefined;
        this.stopping = false;
        onEnd({ stopped, exitCode: code, stderr });
      });
    });
  }

  stop(): void {
    if (this.proc === undefined) {
      return;
    }
    this.stopping = true;
    this.proc.kill();
  }
}
