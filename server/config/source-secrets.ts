import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

type SourceSecrets = Record<string, string>;

export class SourceSecretStore {
  readonly path: string;

  constructor(path = process.env.SOURCE_SECRET_PATH ?? ".data/source-secrets.json") {
    this.path = resolve(path);
  }

  private async readAll(): Promise<SourceSecrets> {
    try {
      const value = JSON.parse(await readFile(this.path, "utf8")) as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Invalid source secret store");
      }
      return Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  }

  async get(key: string): Promise<string | null> {
    return (await this.readAll())[key] ?? null;
  }

  async set(key: string, secret: string): Promise<void> {
    const secrets = await this.readAll();
    secrets[key] = secret;
    await mkdir(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(secrets, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, this.path);
  }

  async delete(key: string): Promise<void> {
    const secrets = await this.readAll();
    if (!(key in secrets)) return;
    delete secrets[key];
    await mkdir(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(secrets, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, this.path);
  }
}
