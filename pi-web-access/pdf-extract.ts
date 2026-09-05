/**
 * PDF Content Extractor
 *
 * Converts PDFs to Markdown. The `auto` provider chain runs Datalab
 * (deterministic, layout-aware) first, then Gemini API, with unpdf as the
 * deterministic local fallback; the chain can also be pinned with
 * `pdf.provider`.
 */

import { existsSync, readFileSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { CredentialResolutionError } from "./credential-source.ts";
import {
	DATALAB_MODE_VALUES,
	DEFAULT_DATALAB_TIMEOUT_MS,
	isDatalabApiAvailable,
	normalizeDatalabMode,
	extractPDFViaDatalab,
	type DatalabMode,
} from "./datalab-pdf-extract.ts";
import { isGeminiApiAvailable } from "./gemini-api.ts";
import { extractPDFViaGemini } from "./gemini-pdf-extract.ts";
import { getWebSearchConfigPath } from "./utils.ts";

export interface PDFExtractResult {
	title: string;
	pages: number;
	chars: number;
	outputPath: string;
	sourcePath?: string;
	metadataPath?: string;
	converter?: string;
}

export interface PDFExtractOptions {
	maxPages?: number;
	outputDir?: string;
	filename?: string;
	signal?: AbortSignal;
	geminiTimeoutMs?: number;
}

export type PDFProvider = "auto" | "gemini" | "datalab" | "unpdf" | "document-convert";

export const PDF_PROVIDER_VALUES = new Set<PDFProvider>([
	"auto",
	"gemini",
	"datalab",
	"unpdf",
	"document-convert",
]);

export interface PDFConfig {
	enabled: boolean;
	maxSizeMB: number;
	maxPages: number;
	provider: PDFProvider;
	datalabMode: DatalabMode;
	datalabTimeoutMs: number;
}

export const DEFAULT_PDF_MAX_SIZE_MB = 20;
export const MAX_PDF_MAX_SIZE_MB = 50;
export const MAX_DATALAB_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_PAGES = 100;
const DEFAULT_OUTPUT_DIR = join(tmpdir(), "pi-web-pdf");
const CONFIG_PATH = getWebSearchConfigPath();
const PAGE_MARKER_PATTERN = /^<!-- Page (\d+) -->$/gm;


const DOCUMENT_CONVERTER_MAX_CAPTURE = 64_000;

async function extractPDFViaDocumentConverter(
	buffer: ArrayBuffer,
	url: string,
	options: { outputDir: string; filename?: string; signal?: AbortSignal; maxPages?: number },
): Promise<PDFExtractResult> {
	const command = process.env.PI_DOCUMENT_CONVERT_CMD?.trim();
	if (!command) {
		throw new Error("pdf.provider=document-convert requires PI_DOCUMENT_CONVERT_CMD");
	}
	const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
	await mkdir(options.outputDir, { recursive: true });
	const sourcePath = join(options.outputDir, `${id}.pdf`);
	const outputPath = join(options.outputDir, options.filename || `${id}.md`);
	const metadataPath = join(options.outputDir, `${id}.conversion.json`);
	await writeFile(sourcePath, new Uint8Array(buffer), { mode: 0o600 });

	const args = [command, "--input", sourcePath, "--output", outputPath, "--metadata", metadataPath, "--source-url", url];
	if (Number.isInteger(options.maxPages) && (options.maxPages as number) > 0) {
		args.push("--max-pages", String(options.maxPages));
	}
	const result = await new Promise<{ stdout: string; stderr: string }>((resolvePromise, reject) => {
		const child = spawn(process.execPath, args, {
			stdio: ["ignore", "pipe", "pipe"],
			env: process.env,
		});
		let stdout = "";
		let stderr = "";
		const capture = (current: string, chunk: Buffer | string) => {
			if (current.length >= DOCUMENT_CONVERTER_MAX_CAPTURE) return current;
			const text = String(chunk);
			return current + text.slice(0, DOCUMENT_CONVERTER_MAX_CAPTURE - current.length);
		};
		child.stdout?.on("data", (chunk) => { stdout = capture(stdout, chunk); });
		child.stderr?.on("data", (chunk) => { stderr = capture(stderr, chunk); });
		const abort = () => child.kill("SIGTERM");
		if (options.signal) {
			if (options.signal.aborted) abort();
			else options.signal.addEventListener("abort", abort, { once: true });
		}
		child.on("error", reject);
		child.on("close", (code) => {
			options.signal?.removeEventListener("abort", abort);
			if (options.signal?.aborted) return reject(new Error("PDF conversion aborted"));
			if (code !== 0) return reject(new Error((stderr.trim() || stdout.trim() || `converter exited ${code}`).slice(-4000)));
			resolvePromise({ stdout, stderr });
		});
	});

	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
	} catch {
		throw new Error(`Document converter returned invalid JSON: ${result.stdout.slice(-1000)}`);
	}
	return {
		title: typeof parsed.title === "string" ? parsed.title : extractTitleFromURL(url),
		pages: typeof parsed.pages === "number" ? parsed.pages : 0,
		chars: typeof parsed.chars === "number" ? parsed.chars : 0,
		outputPath,
		sourcePath,
		metadataPath,
		converter: typeof parsed.converter === "string" ? parsed.converter : "document-convert",
	};
}

export function loadPDFConfig(): PDFConfig {
	if (!existsSync(CONFIG_PATH)) {
		return {
			enabled: true,
			maxSizeMB: DEFAULT_PDF_MAX_SIZE_MB,
			maxPages: DEFAULT_MAX_PAGES,
			provider: "auto",
			datalabMode: normalizeDatalabMode(process.env.DATALAB_MODE),
			datalabTimeoutMs: DEFAULT_DATALAB_TIMEOUT_MS,
		};
	}

	const rawText = readFileSync(CONFIG_PATH, "utf-8");
	let raw: unknown;
	try {
		raw = JSON.parse(rawText) as unknown;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Failed to parse ${CONFIG_PATH}: ${message}`);
	}

	const root =
		raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
	const pdf =
		root.pdf && typeof root.pdf === "object"
			? (root.pdf as Record<string, unknown>)
			: {};
	const enabled = pdf.enabled !== false;
	const configured = pdf.maxSizeMB;
	const normalized =
		typeof configured === "number" &&
		Number.isFinite(configured) &&
		configured > 0
			? Math.min(configured, MAX_PDF_MAX_SIZE_MB)
			: DEFAULT_PDF_MAX_SIZE_MB;
	const configuredMaxPages = pdf.maxPages;
	const maxPages =
		typeof configuredMaxPages === "number" &&
		Number.isFinite(configuredMaxPages) &&
		configuredMaxPages > 0
			? Math.max(1, Math.floor(configuredMaxPages))
			: DEFAULT_MAX_PAGES;

	const provider =
		typeof pdf.provider === "string" &&
		PDF_PROVIDER_VALUES.has(pdf.provider as PDFProvider)
			? (pdf.provider as PDFProvider)
			: "auto";
	const datalabMode =
		typeof pdf.datalabMode === "string" &&
		DATALAB_MODE_VALUES.has(pdf.datalabMode as DatalabMode)
			? (pdf.datalabMode as DatalabMode)
			: normalizeDatalabMode(process.env.DATALAB_MODE);
	const configuredTimeout = pdf.datalabTimeoutMs;
	const datalabTimeoutMs =
		typeof configuredTimeout === "number" &&
		Number.isFinite(configuredTimeout) &&
		configuredTimeout > 0
			? Math.min(configuredTimeout, MAX_DATALAB_TIMEOUT_MS)
			: DEFAULT_DATALAB_TIMEOUT_MS;

	return {
		enabled,
		maxSizeMB: normalized,
		maxPages,
		provider,
		datalabMode,
		datalabTimeoutMs,
	};
}

async function getUnpdf() {
	if (
		typeof (Promise as PromiseConstructor & { try?: unknown }).try !==
		"function"
	) {
		const { default: promiseTry } = await import("promise.try");
		promiseTry.shim();
	}

	const [unpdf, pdfjs] = await Promise.all([
		import("unpdf"),
		import("unpdf/pdfjs"),
	]);
	const { VerbosityLevel } = pdfjs as typeof pdfjs & {
		VerbosityLevel: { ERRORS: number };
	};

	return { getDocumentProxy: unpdf.getDocumentProxy, VerbosityLevel };
}

/**
 * Extract text from a PDF buffer and save it to a Markdown file.
 */
export async function extractPDFToMarkdown(
	buffer: ArrayBuffer,
	url: string,
	options: PDFExtractOptions = {},
): Promise<PDFExtractResult> {
	const {
		maxPages,
		outputDir = DEFAULT_OUTPUT_DIR,
		filename,
		signal,
		geminiTimeoutMs,
	} = options;

	const pdfConfig = loadPDFConfig();
	const safeMaxPages =
		maxPages === undefined
			? pdfConfig.maxPages
			: Number.isFinite(maxPages)
				? Math.max(1, Math.floor(maxPages))
				: DEFAULT_MAX_PAGES;
	const urlTitle = extractTitleFromURL(url);
	const provider = pdfConfig.provider;

	if (provider === "document-convert") {
		return extractPDFViaDocumentConverter(buffer, url, {
			outputDir,
			filename,
			...(signal ? { signal } : {}),
			...(maxPages !== undefined ? { maxPages: Math.max(1, Math.floor(maxPages)) } : {}),
		});
	}

	if (provider === "auto" || provider === "datalab") {
		try {
			if (isDatalabApiAvailable()) {
				const result = await extractPDFViaDatalab(buffer, {
					maxPages: safeMaxPages,
					title: urlTitle,
					mode: pdfConfig.datalabMode,
					timeoutMs: pdfConfig.datalabTimeoutMs,
					...(signal ? { signal } : {}),
				});
				return writeMarkdownResult({
					markdownBody: result.markdown,
					title: urlTitle,
					pages: result.pages,
					outputDir,
					filename,
					url,
				});
			}
		} catch (err) {
			if (shouldRethrowExtractionError(err, signal)) throw err;
		}
	}

	if (provider === "auto" || provider === "gemini") {
		try {
			if (isGeminiApiAvailable()) {
				const markdownBody = await extractPDFViaGemini(buffer, {
					maxPages: safeMaxPages,
					title: urlTitle,
					...(signal ? { signal } : {}),
					...(geminiTimeoutMs !== undefined
						? { timeoutMs: geminiTimeoutMs }
						: {}),
				});
				return writeMarkdownResult({
					markdownBody,
					title: urlTitle,
					pages: countPageMarkers(markdownBody),
					outputDir,
					filename,
					url,
				});
			}
		} catch (err) {
			if (shouldRethrowExtractionError(err, signal)) throw err;
		}
	}

	const { getDocumentProxy, VerbosityLevel } = await getUnpdf();
	const pdf = await getDocumentProxy(new Uint8Array(buffer), {
		verbosity: VerbosityLevel.ERRORS,
	});
	const metadata = await pdf.getMetadata();
	const metadataInfo =
		metadata.info && typeof metadata.info === "object"
			? (metadata.info as Record<string, unknown>)
			: null;

	const metaTitle =
		typeof metadataInfo?.Title === "string" ? metadataInfo.Title : undefined;
	const metaAuthor =
		typeof metadataInfo?.Author === "string" ? metadataInfo.Author : undefined;
	const title = metaTitle?.trim() || urlTitle;
	const pagesToExtract = Math.min(pdf.numPages, safeMaxPages);
	const truncated = pdf.numPages > safeMaxPages;
	const pages: { pageNum: number; text: string }[] = [];

	for (let i = 1; i <= pagesToExtract; i++) {
		const page = await pdf.getPage(i);
		const textContent = await page.getTextContent();
		const pageText = textContent.items
			.map((item: unknown) => {
				const textItem = item as { str?: string };
				return textItem.str || "";
			})
			.join(" ")
			.replace(/\s+/g, " ")
			.trim();

		if (pageText) {
			pages.push({ pageNum: i, text: pageText });
		}
	}

	const bodyLines: string[] = [];
	for (let i = 0; i < pages.length; i++) {
		if (i > 0) {
			bodyLines.push("");
			bodyLines.push(`<!-- Page ${pages[i].pageNum} -->`);
			bodyLines.push("");
		}
		bodyLines.push(pages[i].text);
	}

	return writeMarkdownResult({
		markdownBody: bodyLines.join("\n"),
		title,
		pages: pdf.numPages,
		outputDir,
		filename,
		url,
		metaAuthor,
		truncated,
		pagesToExtract,
	});
}

async function writeMarkdownResult(options: {
	markdownBody: string;
	title: string;
	pages: number;
	outputDir: string;
	filename?: string;
	url: string;
	metaAuthor?: string;
	truncated?: boolean;
	pagesToExtract?: number;
}): Promise<PDFExtractResult> {
	const lines: string[] = [];
	lines.push(`# ${options.title}`);
	lines.push("");
	lines.push(`> Source: ${options.url}`);
	lines.push(
		`> Pages: ${options.pages}${options.truncated ? ` (extracted first ${options.pagesToExtract})` : ""}`,
	);
	if (options.metaAuthor) lines.push(`> Author: ${options.metaAuthor}`);
	lines.push("");
	lines.push("---");
	lines.push("");
	if (options.markdownBody) lines.push(options.markdownBody);

	if (options.truncated) {
		lines.push("");
		lines.push("---");
		lines.push("");
		lines.push(
			`*[Truncated: Only first ${options.pagesToExtract} of ${options.pages} pages extracted]*`,
		);
	}

	const content = lines.join("\n");
	const outputFilename =
		options.filename || sanitizeFilename(options.title) + ".md";
	const outputPath = join(options.outputDir, outputFilename);

	await mkdir(options.outputDir, { recursive: true });
	await writeFile(outputPath, content, "utf-8");

	return {
		title: options.title,
		pages: options.pages,
		chars: content.length,
		outputPath,
	};
}

function countPageMarkers(markdown: string): number {
	return [...markdown.matchAll(PAGE_MARKER_PATTERN)].length;
}

function shouldRethrowExtractionError(
	err: unknown,
	signal?: AbortSignal,
): boolean {
	if (signal?.aborted) return true;
	if (err instanceof CredentialResolutionError) return true;
	const message = err instanceof Error ? err.message : String(err);
	return message.startsWith("Failed to parse ");
}

/**
 * Extract a reasonable title from URL
 */
function extractTitleFromURL(url: string): string {
	try {
		const urlObj = new URL(url);
		const pathname = urlObj.pathname;

		let filename = basename(pathname, ".pdf");

		if (urlObj.hostname.includes("arxiv.org")) {
			const match = pathname.match(/\/(?:pdf|abs)\/(\d+\.\d+)/);
			if (match) {
				filename = `arxiv-${match[1]}`;
			}
		}

		filename = filename.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

		return filename || "document";
	} catch {
		return "document";
	}
}

/**
 * Sanitize string for use as filename
 */
function sanitizeFilename(name: string): string {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9\s-]/g, "")
			.replace(/\s+/g, "-")
			.replace(/-+/g, "-")
			.slice(0, 100)
			.replace(/^-|-$/g, "") || "document"
	);
}

/**
 * Check if URL or content-type indicates a PDF
 */
export function isPDF(url: string, contentType?: string): boolean {
	if (contentType?.includes("application/pdf")) {
		return true;
	}
	try {
		const urlObj = new URL(url);
		return urlObj.pathname.toLowerCase().endsWith(".pdf");
	} catch {
		return false;
	}
}
