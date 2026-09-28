import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Copy,
  Cpu,
  FileImage,
  Files,
  FileText,
  FolderOpen,
  Github,
  HardDrive,
  LoaderCircle,
  Plus,
  RotateCcw,
  ScanLine,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  api,
  exportUrl,
  fileSize,
  type DocumentDetail,
  type DocumentRecord,
  type SystemInfo,
  type ExportFormat,
} from "./api";
import {
  DocumentActions,
  ExportFormatSelect,
  Modal,
  Status,
  UploadModal,
} from "./components";

type Filter = "all" | "processing" | "completed" | "failed";

const ACTIVE_POLL_MS = 2_000;
const IDLE_POLL_MS = 30_000;
const RETRY_POLL_MS = 5_000;
const MAX_RETRY_MS = 60_000;
const REQUEST_TIMEOUT_MS = 15_000;

export default function App() {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [draft, setDraft] = useState<{ text: string; revision: number } | null>(
    null,
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exportFormat, setExportFormat] = useState<ExportFormat>("xlsx");
  const [exporting, setExporting] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [uploadFiles, setUploadFiles] = useState<File[] | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const page = detail?.id === active ? detail.pages[pageNumber - 1] : undefined;
  const dirty = draft !== null && draft.text !== page?.text;
  const reload = useCallback(() => setRefresh((value) => value + 1), []);

  useEffect(() => {
    if (deleting) return;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    let failures = 0;
    async function poll() {
      if (cancelled || document.hidden || controller) return;
      clearTimeout(timeout);
      const request = new AbortController();
      controller = request;
      const deadline = setTimeout(() => request.abort(), REQUEST_TIMEOUT_MS);
      let delay = IDLE_POLL_MS;
      try {
        const [docs, info, current] = await Promise.all([
          api<DocumentRecord[]>("/documents", { signal: request.signal }),
          api<SystemInfo>("/system", { signal: request.signal }),
          active
            ? api<DocumentDetail>(`/documents/${active}`, {
                signal: request.signal,
              })
            : Promise.resolve(null),
        ]);
        if (!cancelled && controller === request) {
          failures = 0;
          if (docs.some((doc) => ["queued", "processing"].includes(doc.status)))
            delay = ACTIVE_POLL_MS;
          setDocuments(docs);
          setSystem(info);
          setDetail(current);
          setConnectionError(false);
          setSelected(
            (previous) =>
              new Set(
                [...previous].filter((id) => docs.some((doc) => doc.id === id)),
              ),
          );
        }
      } catch {
        request.abort();
        if (!cancelled && controller === request) {
          failures += 1;
          delay = Math.min(RETRY_POLL_MS * 2 ** (failures - 1), MAX_RETRY_MS);
          setConnectionError(true);
        }
      } finally {
        clearTimeout(deadline);
        if (!cancelled && controller === request) {
          controller = null;
          if (!document.hidden) timeout = setTimeout(poll, delay);
        }
      }
    }
    function visibilityChanged() {
      clearTimeout(timeout);
      if (document.hidden) {
        controller?.abort();
        controller = null;
      } else {
        void poll();
      }
    }
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("online", visibilityChanged);
    void poll();
    return () => {
      cancelled = true;
      controller?.abort();
      clearTimeout(timeout);
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.removeEventListener("online", visibilityChanged);
    };
  }, [active, refresh, deleting]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timeout);
  }, [toast]);

  function navigate(id: string | null, nextFilter?: Filter) {
    if (
      saving ||
      deleting ||
      (dirty && !window.confirm("Discard your unsaved changes?"))
    )
      return;
    setActive(id);
    setDetail(null);
    setPageNumber(1);
    setDraft(null);
    setZoom(false);
    if (nextFilter) setFilter(nextFilter);
  }

  function changePage(number: number) {
    if (
      saving ||
      deleting ||
      (dirty && !window.confirm("Discard your unsaved changes?"))
    )
      return;
    setPageNumber(number);
    setDraft(null);
    setZoom(false);
  }

  async function save() {
    if (!page || !draft || !active) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api<typeof page>(
        `/documents/${active}/pages/${pageNumber}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        },
      );
      setDetail((current) =>
        current
          ? {
              ...current,
              pages: current.pages.map((item) =>
                item.page_number === pageNumber ? updated : item,
              ),
            }
          : current,
      );
      setDraft(null);
      setToast("Changes saved");
      reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function retry() {
    if (!active) return;
    try {
      await api(`/documents/${active}/retry`, { method: "POST" });
      setToast("Failed pages queued for another attempt");
      reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(targets: DocumentRecord[]) {
    const label =
      targets.length === 1
        ? `“${targets[0].filename}”`
        : `${targets.length} selected documents`;
    if (
      deleting ||
      saving ||
      !targets.length ||
      !window.confirm(
        `Permanently delete ${label}? This removes the original files, all page previews, extracted text, and saved edits. This cannot be undone.`,
      )
    )
      return;
    setDeleting(true);
    setError(null);
    const deleted = new Set<string>();
    const failures: string[] = [];
    try {
      for (const document of targets) {
        try {
          await api(`/documents/${document.id}`, { method: "DELETE" });
          deleted.add(document.id);
        } catch (err) {
          failures.push(`${document.filename}: ${(err as Error).message}`);
        }
      }
      setDocuments((current) =>
        current.filter((document) => !deleted.has(document.id)),
      );
      setSelected(
        (current) => new Set([...current].filter((id) => !deleted.has(id))),
      );
      if (active && deleted.has(active)) {
        setDraft(null);
        setActive(null);
        setDetail(null);
        setPageNumber(1);
      }
      if (deleted.size)
        setToast(
          deleted.size === 1
            ? "Document permanently deleted"
            : `${deleted.size} documents permanently deleted`,
        );
      if (failures.length)
        setError(
          `Could not delete ${failures.length} document(s). ${failures.join(" ")}`,
        );
    } finally {
      setDeleting(false);
      reload();
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(draft?.text ?? page?.text ?? "");
      setToast("Text copied");
    } catch {
      setError(
        "Could not access the clipboard. Select the text and copy it manually.",
      );
    }
  }

  async function downloadExport(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    const href = event.currentTarget.getAttribute("href");
    if (!href || exporting) return;
    setExporting(true);
    setError(null);
    try {
      const response = await fetch(href);
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail ?? `Export failed (${response.status}).`);
      }
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const filename = encodedName
        ? decodeURIComponent(encodedName)
        : disposition.match(/filename="([^"]+)"/i)?.[1];
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = filename ?? `folio-export.${exportFormat}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setExporting(false);
    }
  }

  const processing = documents.filter((doc) =>
    ["queued", "processing"].includes(doc.status),
  ).length;
  const completed = documents.filter(
    (doc) => doc.status === "completed",
  ).length;
  const failed = documents.filter((doc) => doc.status === "failed").length;
  const totalPages = documents.reduce((sum, doc) => sum + doc.page_count, 0);
  const visible = documents.filter(
    (doc) =>
      doc.filename.toLowerCase().includes(search.toLowerCase()) &&
      (filter === "all" ||
        (filter === "processing"
          ? ["queued", "processing"].includes(doc.status)
          : doc.status === filter)),
  );
  const allVisibleSelected =
    visible.length > 0 && visible.every((doc) => selected.has(doc.id));
  const exportIds = active ? [active] : [...selected];
  const selectedDocuments = documents.filter((document) =>
    selected.has(document.id),
  );
  const selectionProcessing = selectedDocuments.some((document) =>
    ["queued", "processing"].includes(document.status),
  );

  return (
    <div
      className="app-shell"
      onDragEnter={(event) => {
        if (
          event.dataTransfer.types.includes("Files") &&
          uploadFiles === null
        ) {
          event.preventDefault();
          dragDepth.current++;
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        if (--dragDepth.current <= 0) setDragging(false);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        if (system && uploadFiles === null)
          setUploadFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <aside className="sidebar">
        <button
          className="brand"
          onClick={() => navigate(null, "all")}
          aria-label="Folio home"
        >
          <span className="brand-icon">
            <ScanLine size={23} />
          </span>
          folio<span className="brand-period">.</span>
        </button>
        <div className="workspace-name">
          <span className="workspace-avatar">W</span>
          <div>
            My workspace<small>Local edition</small>
          </div>
          <HardDrive size={15} />
        </div>
        <nav aria-label="Workspace">
          <button
            className={`nav-item ${!active && filter === "all" ? "active" : ""}`}
            onClick={() => navigate(null, "all")}
          >
            <Files size={19} />
            All documents<span>{documents.length}</span>
          </button>
          <button
            className={`nav-item ${!active && filter === "processing" ? "active" : ""}`}
            onClick={() => navigate(null, "processing")}
          >
            <ScanLine size={19} />
            Processing{processing > 0 && <span>{processing}</span>}
          </button>
          <button
            className={`nav-item ${!active && filter === "failed" ? "active" : ""}`}
            onClick={() => navigate(null, "failed")}
          >
            <AlertCircle size={19} />
            Needs attention{failed > 0 && <span>{failed}</span>}
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="runtime-card">
            <div>
              <span
                className={`online-dot ${connectionError ? "offline" : ""}`}
              />
              {connectionError ? "Server disconnected" : "Local processing"}
            </div>
            <p>
              {system?.runtime.backend ??
                (system?.runtime.state === "loading"
                  ? "Preparing models…"
                  : "Ready when you are")}
            </p>
            <small>Your files stay on this computer.</small>
          </div>
          <button className="nav-item" onClick={() => setShowSettings(true)}>
            <Settings2 size={18} />
            Processing settings
          </button>
          <button className="nav-item" onClick={() => setShowHelp(true)}>
            <CircleHelp size={18} />
            How it works
            <ArrowUpRight size={14} />
          </button>
          <div className="sidebar-foot">
            Folio OCR <span>v0.1</span>
          </div>
          <a
            className="author-credit"
            href="https://github.com/klienn"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Built by Klienn — GitHub profile (opens in a new tab)"
            title="Built by Klienn"
          >
            <Github size={14} aria-hidden="true" />
            <span>Built by Klienn</span>
          </a>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <FolderOpen size={16} />
            <span>Workspace</span>
            <span className="slash">/</span>
            <strong>{active ? "Document review" : "Documents"}</strong>
          </div>
          <span className="private-badge">
            <ShieldCheck size={15} />
            Private by design
          </span>
        </header>
        <div className="main-content">
          {connectionError && (
            <div className="error-box" role="alert">
              Cannot reach the local server. Make sure the backend is running on
              port 8000. Reconnecting automatically…
            </div>
          )}
          {error && (
            <div className="error-box dismissible" role="alert">
              {error}
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError(null)}
              >
                <X size={16} />
              </button>
            </div>
          )}

          {!active ? (
            <>
              <section className="page-heading">
                <div>
                  <h1>Your document workspace</h1>
                  <p>
                    From a page to possibilities. Extract, refine, and export
                    your text.
                  </p>
                </div>
                <button
                  className="button primary"
                  disabled={!system}
                  onClick={() => setUploadFiles([])}
                >
                  <Plus size={18} />
                  Add documents
                </button>
              </section>
              <section className="overview" aria-label="Workspace summary">
                <div>
                  <span className="overview-icon blue">
                    <Files size={20} />
                  </span>
                  <div>
                    <strong>{documents.length}</strong>
                    <span>Documents</span>
                  </div>
                </div>
                <div>
                  <span className="overview-icon green">
                    <Check size={20} />
                  </span>
                  <div>
                    <strong>{completed}</strong>
                    <span>Ready to export</span>
                  </div>
                </div>
                <div>
                  <span className="overview-icon violet">
                    <FileText size={20} />
                  </span>
                  <div>
                    <strong>{totalPages}</strong>
                    <span>Total pages</span>
                  </div>
                </div>
                <div className="overview-note">
                  <ShieldCheck size={20} />
                  <p>
                    On your device.
                    <br />
                    <strong>Under your control.</strong>
                  </p>
                </div>
              </section>

              <section className="library" aria-labelledby="library-title">
                <div className="library-heading">
                  <h2 id="library-title">
                    Document library <span>{documents.length}</span>
                  </h2>
                  <div className="export-controls">
                    {selected.size > 0 && (
                      <button
                        className="button secondary danger"
                        disabled={deleting || selectionProcessing}
                        title={
                          selectionProcessing
                            ? "Wait for selected documents to finish processing before deleting."
                            : "Permanently delete selected documents"
                        }
                        onClick={() => remove(selectedDocuments)}
                      >
                        {deleting ? (
                          <LoaderCircle size={16} className="spin" />
                        ) : (
                          <Trash2 size={16} />
                        )}
                        {deleting
                          ? "Deleting…"
                          : `Delete ${selected.size} selected`}
                      </button>
                    )}
                    <ExportFormatSelect
                      value={exportFormat}
                      onChange={setExportFormat}
                    />
                    <a
                      className={`button secondary ${!documents.length || exporting ? "disabled" : ""}`}
                      aria-disabled={!documents.length || exporting}
                      aria-busy={exporting}
                      onClick={downloadExport}
                      href={
                        documents.length
                          ? exportUrl(exportIds, exportFormat)
                          : undefined
                      }
                    >
                      <ArrowDownToLine size={16} />
                      {selected.size
                        ? `Export ${selected.size} selected`
                        : `Export all to ${exportFormat === "xlsx" ? "Excel" : "CSV"}`}
                    </a>
                  </div>
                </div>
                <div className="library-toolbar">
                  <div className="tabs" aria-label="Filter documents">
                    {(
                      [
                        ["all", "All documents"],
                        ["completed", "Ready"],
                        ["processing", "Processing"],
                        ["failed", "Needs attention"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        className={filter === value ? "selected" : ""}
                        aria-pressed={filter === value}
                        onClick={() => setFilter(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <label className="search">
                    <Search size={16} />
                    <input
                      placeholder="Find a document…"
                      aria-label="Find a document"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </label>
                </div>
                {visible.length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th className="select-cell">
                            <input
                              type="checkbox"
                              aria-label="Select all visible documents"
                              checked={allVisibleSelected}
                              onChange={() =>
                                setSelected((current) => {
                                  const next = new Set(current);
                                  visible.forEach((doc) =>
                                    allVisibleSelected
                                      ? next.delete(doc.id)
                                      : next.add(doc.id),
                                  );
                                  return next;
                                })
                              }
                            />
                          </th>
                          <th>Document name</th>
                          <th>Status</th>
                          <th>Pages</th>
                          <th>Added</th>
                          <th>
                            <span className="sr-only">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {visible.map((doc) => (
                          <tr
                            key={doc.id}
                            className={
                              selected.has(doc.id) ? "row-selected" : ""
                            }
                          >
                            <td>
                              <input
                                type="checkbox"
                                aria-label={`Select ${doc.filename}`}
                                checked={selected.has(doc.id)}
                                onChange={() =>
                                  setSelected((current) => {
                                    const next = new Set(current);
                                    if (next.has(doc.id)) next.delete(doc.id);
                                    else next.add(doc.id);
                                    return next;
                                  })
                                }
                              />
                            </td>
                            <td>
                              <button
                                className="document-link"
                                onClick={() => navigate(doc.id)}
                              >
                                <span
                                  className={`file-icon ${doc.kind === "pdf" ? "pdf" : "image"}`}
                                >
                                  {doc.kind === "pdf" ? (
                                    <FileText size={23} />
                                  ) : (
                                    <FileImage size={23} />
                                  )}
                                </span>
                                <span>
                                  <strong>{doc.filename}</strong>
                                  <small>
                                    {doc.kind === "pdf"
                                      ? "PDF document"
                                      : "Image"}
                                    <span className="dot-separator" />
                                    {fileSize(doc.size)}
                                  </small>
                                </span>
                              </button>
                            </td>
                            <td>
                              <Status status={doc.status} />
                              {["processing", "queued"].includes(
                                doc.status,
                              ) && (
                                <small className="progress-label">
                                  {doc.completed_pages + doc.failed_pages} /{" "}
                                  {doc.page_count} pages
                                </small>
                              )}
                            </td>
                            <td className="page-count">{doc.page_count}</td>
                            <td className="date-cell">
                              {new Date(doc.created_at).toLocaleDateString(
                                undefined,
                                { month: "short", day: "numeric" },
                              )}
                            </td>
                            <td>
                              <DocumentActions
                                document={doc}
                                busy={deleting}
                                onOpen={() => navigate(doc.id)}
                                onDelete={() => remove([doc])}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty-library">
                    {documents.length === 0 ? (
                      <>
                        <div className="paper-illustration" aria-hidden="true">
                          <div className="paper-back" />
                          <div className="paper-front">
                            <ScanLine size={28} />
                            <i />
                            <i />
                            <i />
                            <div className="paper-check">
                              <Check size={14} />
                            </div>
                          </div>
                          <span className="scan-corner top-left" />
                          <span className="scan-corner bottom-right" />
                        </div>
                        <h3>A fresh page starts here</h3>
                        <p>
                          Add a scan, a photo, or a PDF.
                          <br />
                          We’ll take care of the text, one page at a time.
                        </p>
                        <button
                          className="button primary"
                          disabled={!system}
                          onClick={() => setUploadFiles([])}
                        >
                          <Upload size={17} />
                          Upload your first document
                        </button>
                        <small>JPG, PNG, PDF · Single or multiple pages</small>
                      </>
                    ) : (
                      <>
                        <Search size={32} className="empty-search" />
                        <h3>No documents found</h3>
                        <p>
                          Try another search or switch to a different filter.
                        </p>
                        <button
                          className="button secondary"
                          onClick={() => {
                            setSearch("");
                            setFilter("all");
                          }}
                        >
                          Show all documents
                        </button>
                      </>
                    )}
                  </div>
                )}
                <div className="library-footer">
                  <span>
                    {selected.size
                      ? `${selected.size} selected`
                      : `${visible.length} ${visible.length === 1 ? "document" : "documents"}`}
                  </span>
                  <span>
                    <HardDrive size={13} />
                    Stored locally
                  </span>
                </div>
              </section>
              <div className="workflow-note">
                <span>
                  <Upload size={16} />
                  Upload
                </span>
                <ChevronRight size={13} />
                <span>
                  <ScanLine size={16} />
                  Extract
                </span>
                <ChevronRight size={13} />
                <span>
                  <FileText size={16} />
                  Review
                </span>
                <ChevronRight size={13} />
                <span>
                  <ArrowDownToLine size={16} />
                  Export
                </span>
              </div>
            </>
          ) : (
            <>
              <button className="back-link" onClick={() => navigate(null)}>
                <ArrowLeft size={16} />
                Back to documents
              </button>
              {detail?.id === active ? (
                <>
                  <section className="page-heading review-heading">
                    <div>
                      <h1 title={detail.filename}>{detail.filename}</h1>
                      <p>
                        {detail.page_count}{" "}
                        {detail.page_count === 1 ? "page" : "pages"}
                        <span className="dot-separator" />
                        {fileSize(detail.size)}
                        <span className="dot-separator" />
                        {
                          system?.languages.find(
                            (lang) => lang.id === detail.language,
                          )?.label
                        }
                      </p>
                    </div>
                    <div className="heading-actions">
                      <Status status={detail.status} />
                      <div className="export-controls">
                        <ExportFormatSelect
                          value={exportFormat}
                          onChange={setExportFormat}
                        />
                        <a
                          className={`button secondary ${dirty || exporting ? "disabled" : ""}`}
                          aria-disabled={dirty || exporting}
                          aria-busy={exporting}
                          onClick={downloadExport}
                          href={
                            dirty
                              ? undefined
                              : exportUrl([active], exportFormat)
                          }
                          title={
                            dirty
                              ? "Save your changes before exporting"
                              : "Export saved text"
                          }
                        >
                          <ArrowDownToLine size={16} />
                          Export {exportFormat === "xlsx" ? "Excel" : "CSV"}
                        </a>
                      </div>
                    </div>
                  </section>
                  {detail.error && (
                    <div className="error-box dismissible">
                      <span>{detail.error}</span>
                      <button className="button secondary" onClick={retry}>
                        <RotateCcw size={15} />
                        Retry failed pages
                      </button>
                    </div>
                  )}
                  {["processing", "queued"].includes(detail.status) && (
                    <div className="processing-bar">
                      <LoaderCircle size={17} className="spin" />
                      <span>
                        {detail.status === "queued"
                          ? "Waiting in the queue"
                          : `Processing page ${Math.min(detail.completed_pages + detail.failed_pages + 1, detail.page_count)} of ${detail.page_count}`}
                        {system?.runtime.state === "loading" &&
                          " · Preparing OCR models for first use…"}
                      </span>
                      <progress
                        value={detail.completed_pages + detail.failed_pages}
                        max={detail.page_count}
                      />
                    </div>
                  )}
                  <section className="review-workspace">
                    <div className="review-tools">
                      <div className="page-navigation">
                        <button
                          className="icon-button"
                          aria-label="Previous page"
                          disabled={pageNumber === 1 || saving}
                          onClick={() => changePage(pageNumber - 1)}
                        >
                          <ChevronLeft size={18} />
                        </button>
                        <label>
                          Page{" "}
                          <select
                            aria-label="Page number"
                            value={pageNumber}
                            disabled={saving}
                            onChange={(event) =>
                              changePage(Number(event.target.value))
                            }
                          >
                            {detail.pages.map((item) => (
                              <option
                                key={item.page_number}
                                value={item.page_number}
                              >
                                {item.page_number}
                                {item.status === "failed" ? " (failed)" : ""}
                              </option>
                            ))}
                          </select>{" "}
                          of {detail.page_count}
                        </label>
                        <button
                          className="icon-button"
                          aria-label="Next page"
                          disabled={pageNumber === detail.page_count || saving}
                          onClick={() => changePage(pageNumber + 1)}
                        >
                          <ChevronRight size={18} />
                        </button>
                      </div>
                      <a
                        className="text-link"
                        href={`/api/documents/${active}/original`}
                      >
                        <ArrowDownToLine size={14} />
                        Original file
                      </a>
                    </div>
                    <div className="review-columns">
                      <div className="preview-panel">
                        <div className="panel-heading">
                          <h2>Original page</h2>
                          <button
                            className="icon-button"
                            aria-label={zoom ? "Zoom out" : "Zoom in"}
                            onClick={() => setZoom(!zoom)}
                          >
                            {zoom ? (
                              <ZoomOut size={17} />
                            ) : (
                              <ZoomIn size={17} />
                            )}
                          </button>
                        </div>
                        <div className={`page-preview ${zoom ? "zoomed" : ""}`}>
                          {page &&
                          ["completed", "failed"].includes(page.status) ? (
                            <img
                              key={`${active}-${pageNumber}-${page.updated_at}`}
                              src={`/api/documents/${active}/pages/${pageNumber}/preview`}
                              alt={`Original page ${pageNumber} of ${detail.filename}`}
                            />
                          ) : (
                            <div className="preview-pending">
                              <ScanLine size={38} />
                              <p>
                                The preview will appear
                                <br />
                                when this page is processed.
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="text-panel">
                        <div className="panel-heading">
                          <h2>Extracted text</h2>
                          <button
                            className="icon-button"
                            aria-label="Copy extracted text"
                            disabled={page?.status !== "completed"}
                            onClick={copy}
                          >
                            <Copy size={17} />
                          </button>
                        </div>
                        {page?.status === "completed" ? (
                          <>
                            <textarea
                              className="text-editor"
                              aria-label="Extracted text"
                              dir="auto"
                              value={draft?.text ?? page.text}
                              disabled={saving}
                              onChange={(event) =>
                                setDraft({
                                  text: event.target.value,
                                  revision: draft?.revision ?? page.revision,
                                })
                              }
                              placeholder="No text was detected on this page. You can enter text here."
                              spellCheck={false}
                            />
                            <div className="text-metadata">
                              <span>
                                {page.method === "embedded"
                                  ? "Read from PDF text layer"
                                  : `${page.backend} OCR`}
                              </span>
                              <span>
                                {page.confidence !== null
                                  ? `${Math.round(page.confidence * 100)}% model confidence`
                                  : "Direct extraction"}
                              </span>
                            </div>
                            <details className="raw-text">
                              <summary>View original extraction</summary>
                              <pre dir="auto">
                                {page.raw_text || "(No text detected)"}
                              </pre>
                            </details>
                          </>
                        ) : (
                          <div className="text-pending">
                            {page?.status === "failed" ? (
                              <>
                                <AlertCircle size={30} />
                                <h3>Couldn’t read this page</h3>
                                <p>{page.error}</p>
                                <button
                                  className="button secondary"
                                  onClick={retry}
                                >
                                  <RotateCcw size={15} />
                                  Retry failed pages
                                </button>
                              </>
                            ) : (
                              <>
                                <LoaderCircle
                                  size={28}
                                  className={
                                    page?.status === "processing" ? "spin" : ""
                                  }
                                />
                                <h3>
                                  {page?.status === "processing"
                                    ? "Reading your page…"
                                    : "Your text will appear here"}
                                </h3>
                                <p>
                                  You can review each page as soon as it’s
                                  ready.
                                </p>
                              </>
                            )}
                          </div>
                        )}
                        <div className="editor-footer">
                          <span className={dirty ? "unsaved" : ""}>
                            {dirty
                              ? "Unsaved changes"
                              : page?.is_edited
                                ? "Changes saved"
                                : "Review and correct as needed"}
                          </span>
                          <button
                            className="button primary"
                            disabled={!dirty || saving || deleting}
                            onClick={save}
                          >
                            {saving ? (
                              <LoaderCircle size={16} className="spin" />
                            ) : (
                              <Check size={16} />
                            )}
                            {saving ? "Saving…" : "Save changes"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </section>
                  <div className="review-footer">
                    <span>
                      <ShieldCheck size={15} />
                      Original extraction is preserved when you edit.
                    </span>
                    <button
                      className="text-link danger"
                      disabled={
                        ["processing", "queued"].includes(detail.status) ||
                        saving ||
                        deleting
                      }
                      title={
                        ["queued", "processing"].includes(detail.status)
                          ? "Wait for processing to finish before deleting."
                          : "Permanently delete document"
                      }
                      onClick={() => remove([detail])}
                    >
                      <Trash2 size={14} />
                      {deleting ? "Deleting…" : "Delete document"}
                    </button>
                  </div>
                </>
              ) : (
                <div className="loading-state">
                  <LoaderCircle size={28} className="spin" />
                  Opening document…
                </div>
              )}
            </>
          )}
        </div>
      </main>
      {dragging && (
        <div className="drop-overlay">
          <Upload size={48} />
          <h2>Drop your documents here</h2>
          <p>PDF, JPG, or PNG</p>
        </div>
      )}
      {uploadFiles !== null && system && (
        <UploadModal
          initialFiles={uploadFiles}
          system={system}
          close={() => {
            setUploadFiles(null);
            reload();
          }}
          done={(docs) => {
            setUploadFiles(null);
            reload();
            setToast(
              `${docs.length} document${docs.length === 1 ? "" : "s"} added`,
            );
            if (docs.length === 1) navigate(docs[0].id);
          }}
        />
      )}
      {showSettings && (
        <Modal title="Local processing" close={() => setShowSettings(false)}>
          <div className="settings-status">
            <Cpu size={28} />
            <div>
              <strong>
                {system?.runtime.backend ?? "OCR models not loaded yet"}
              </strong>
              <p>
                {system?.runtime.message ??
                  "The active backend is validated when a scanned page is processed."}
              </p>
            </div>
          </div>
          <h3>Installed processing backends</h3>
          <div className="device-list">
            {system?.devices.map((device) => (
              <span key={device.id}>
                <Check size={15} />
                {device.label}
              </span>
            ))}
          </div>
          <p className="muted">
            Choose Auto, CPU, or an installed GPU backend when adding documents.
            Auto tests GPU execution and falls back to CPU if it fails.
          </p>
          <p className="muted">
            NVIDIA uses CUDA. AMD uses DirectML on Windows or MIGraphX on
            supported Linux systems. GPU runtime installation instructions are
            in the README.
          </p>
          <div className="info-note">
            <HardDrive size={18} />
            <span>
              One page at a time. Models stay cached on disk, and only one
              language pack is held in memory.
            </span>
          </div>
        </Modal>
      )}
      {showHelp && (
        <Modal title="From document to text" close={() => setShowHelp(false)}>
          <ol className="help-steps">
            <li>
              <strong>Add documents</strong>
              <p>
                Upload images or PDFs and choose the language pack that matches
                your pages. Models download on first use.
              </p>
            </li>
            <li>
              <strong>Review each page</strong>
              <p>
                Compare the original with the extracted text. Correct mistakes
                and save your changes.
              </p>
            </li>
            <li>
              <strong>Export your text</strong>
              <p>
                Download all or selected documents as formatted Excel or UTF-8
                CSV, with one row per page. Exports include saved edits and page
                status.
              </p>
            </li>
          </ol>
          <div className="info-note">
            <ScanLine size={19} />
            <span>
              Handwriting and complex layouts may need corrections. The app
              extracts text; it doesn’t reconstruct tables into spreadsheet
              columns.
            </span>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}
