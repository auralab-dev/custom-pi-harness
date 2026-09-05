import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import type { ExtractedContent } from "./extract.ts";

export interface DownloadedArtifact {
  path: string;
  files: number;
  chars: number;
  bytes: number;
}

const PDF_RECEIPT = /^PDF extracted and saved to:\s*(.+)\n\nPages:\s*\d+\nCharacters:\s*\d+\s*$/s;

function ensurePrivateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe download directory");
}

function writePrivateTextFile(path: string, content: string): number {
  writeFileSync(path, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Unsafe download file");
  return Buffer.byteLength(content);
}

function copyPrivateFile(source: string, destination: string): number {
  if (!existsSync(source)) throw new Error("Document conversion companion file is missing");
  const stat = lstatSync(source);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Unsafe document conversion companion file");
  copyFileSync(source, destination);
  chmodSync(destination, 0o600);
  const copied = lstatSync(destination);
  if (!copied.isFile() || copied.isSymbolicLink()) throw new Error("Unsafe copied download file");
  try { unlinkSync(source); } catch {}
  return copied.size;
}

/**
 * pi-web-access PDF extraction returns a small receipt whose first line points to
 * the real extracted Markdown in its temp directory. Dereference that receipt
 * before persisting so zvec indexes the PDF body rather than the receipt.
 */
function materializeExtractedText(result: ExtractedContent): { body: string; fromPdfReceipt: boolean } {
  const match = PDF_RECEIPT.exec(result.content.trim());
  if (!match) return { body: result.content, fromPdfReceipt: false };
  const extractedPath = match[1].trim();
  if (!extractedPath || !existsSync(extractedPath)) {
    throw new Error("PDF extraction output file is missing");
  }
  const stat = lstatSync(extractedPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("PDF extraction output is not a regular file");
  }
  const body = readFileSync(extractedPath, "utf8");
  try { unlinkSync(extractedPath); } catch {}
  return { body, fromPdfReceipt: true };
}

function renderDownloadedText(result: ExtractedContent): { text: string; bodyChars: number } {
  const materialized = materializeExtractedText(result);
  // PDF converters already emit provenance/page metadata. Do not wrap that
  // Markdown again, otherwise headings and Source lines are duplicated.
  if (materialized.fromPdfReceipt) {
    return { text: materialized.body, bodyChars: materialized.body.length };
  }
  const title = result.title?.trim() || "Downloaded document";
  return {
    text: `# ${title}\n\nSource: ${result.url}\n\n${materialized.body}`,
    bodyChars: materialized.body.length,
  };
}

function persistCompanionFiles(dir: string, result: ExtractedContent, prefix = ""): number {
  let bytes = 0;
  if (result.sourcePath) {
    bytes += copyPrivateFile(result.sourcePath, join(dir, `${prefix}source.pdf`));
  }
  if (result.conversionMetadataPath) {
    bytes += copyPrivateFile(result.conversionMetadataPath, join(dir, `${prefix}conversion.json`));
  }
  return bytes;
}

export function storeDownloadedArtifact(cwd: string, downloadId: string, results: ExtractedContent[]): DownloadedArtifact {
  const root = join(cwd, ".pi", "downloads");
  const dir = join(root, downloadId);
  ensurePrivateDirectory(root);
  ensurePrivateDirectory(dir);

  const usable = results.filter((result) => !result.error && typeof result.content === "string" && result.content.length > 0);
  if (usable.length === 0) throw new Error("Downloaded response contained no searchable textual content");

  let bytes = 0;
  let chars = 0;
  if (usable.length === 1) {
    const rendered = renderDownloadedText(usable[0]);
    bytes += writePrivateTextFile(join(dir, "content.md"), rendered.text);
    bytes += persistCompanionFiles(dir, usable[0]);
    chars += rendered.bodyChars;
    return {
      path: relative(cwd, join(dir, "content.md")).replaceAll("\\", "/"),
      files: 1,
      chars,
      bytes,
    };
  }

  usable.forEach((result, index) => {
    const rendered = renderDownloadedText(result);
    bytes += writePrivateTextFile(join(dir, `${index}.md`), rendered.text);
    bytes += persistCompanionFiles(dir, result, `${index}-`);
    chars += rendered.bodyChars;
  });
  return {
    path: relative(cwd, dir).replaceAll("\\", "/"),
    files: usable.length,
    chars,
    bytes,
  };
}
