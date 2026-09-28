import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  AlertCircle,
  Check,
  FileText,
  LoaderCircle,
  MoreHorizontal,
  FolderOpen,
  Trash2,
  ScanLine,
  Upload,
  X,
} from "lucide-react";
import {
  api,
  fileSize,
  type DocumentRecord,
  type SystemInfo,
  type ExportFormat,
} from "./api";

export function DocumentActions({
  document,
  busy,
  onOpen,
  onDelete,
}: {
  document: DocumentRecord;
  busy: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const processing = ["queued", "processing"].includes(document.status);

  function positionMenu() {
    const rect = trigger.current!.getBoundingClientRect();
    setPosition({
      top:
        rect.bottom + 108 < window.innerHeight
          ? rect.bottom + 4
          : rect.top - 104,
      left: Math.max(8, Math.min(rect.right - 160, window.innerWidth - 168)),
    });
  }

  function close() {
    menu.current?.hidePopover();
    trigger.current?.focus({ preventScroll: true });
  }

  useEffect(() => {
    if (!open) return;
    const dismiss = () => menu.current?.hidePopover();
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={trigger}
        className="icon-button"
        aria-label={`Actions for ${document.filename}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        popoverTarget={id}
        disabled={busy}
        onClick={positionMenu}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            positionMenu();
            menu.current?.showPopover();
          }
        }}
      >
        <MoreHorizontal size={19} />
      </button>
      <div
        ref={menu}
        id={id}
        popover="auto"
        role="menu"
        aria-label={`Actions for ${document.filename}`}
        className="document-menu"
        style={position}
        onToggle={(event) => {
          const visible = event.newState === "open";
          setOpen(visible);
          if (visible)
            menu.current
              ?.querySelector("button")
              ?.focus({ preventScroll: true });
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" || event.key === "Tab") {
            if (event.key === "Escape") event.preventDefault();
            close();
          } else if (
            ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
          ) {
            event.preventDefault();
            const items = [
              ...menu.current!.querySelectorAll<HTMLButtonElement>(
                "button:not(:disabled)",
              ),
            ];
            const index = items.indexOf(event.target as HTMLButtonElement);
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? items.length - 1
                  : (index +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      items.length) %
                    items.length;
            items[next]?.focus();
          }
        }}
      >
        <button
          role="menuitem"
          tabIndex={-1}
          onClick={() => {
            close();
            onOpen();
          }}
        >
          <FolderOpen size={16} /> Open
        </button>
        <button
          role="menuitem"
          tabIndex={-1}
          className="danger"
          disabled={processing || busy}
          title={
            processing
              ? "Wait for processing to finish before deleting."
              : undefined
          }
          onClick={() => {
            close();
            onDelete();
          }}
        >
          <Trash2 size={16} /> Delete
        </button>
      </div>
    </>
  );
}

export function ExportFormatSelect({
  value,
  onChange,
}: {
  value: ExportFormat;
  onChange: (format: ExportFormat) => void;
}) {
  return (
    <select
      className="export-format"
      aria-label="Export format"
      value={value}
      onChange={(event) => onChange(event.target.value as ExportFormat)}
    >
      <option value="xlsx">Excel (.xlsx)</option>
      <option value="csv">CSV (.csv)</option>
    </select>
  );
}

export function Status({ status }: { status: string }) {
  const labels: Record<string, string> = {
    completed: "Ready",
    failed: "Needs attention",
    processing: "Processing",
    queued: "Queued",
    pending: "Waiting",
  };
  return (
    <span className={`status status-${status}`}>
      {status === "completed" ? (
        <Check size={12} />
      ) : status === "failed" ? (
        <AlertCircle size={12} />
      ) : (
        <span
          className={`status-dot ${status === "processing" ? "pulse" : ""}`}
        />
      )}
      {labels[status] ?? status}
    </span>
  );
}

export function Modal({
  title,
  children,
  close,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="modal-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <div className="modal-heading">
        <h2 id="modal-title">{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          disabled={busy}
          onClick={close}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function UploadModal({
  initialFiles,
  system,
  close,
  done,
}: {
  initialFiles: File[];
  system: SystemInfo;
  close: () => void;
  done: (documents: DocumentRecord[]) => void;
}) {
  const [files, setFiles] = useState(initialFiles);
  const [language, setLanguage] = useState("mixed");
  const [device, setDevice] = useState("auto");
  const [handwriting, setHandwriting] = useState(false);
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const accepted = useRef<DocumentRecord[]>([]);

  function addFiles(incoming: File[]) {
    setErrors([]);
    setFiles((current) => [...current, ...incoming].slice(0, 20));
  }

  async function upload() {
    setBusy(true);
    setErrors([]);
    const body = new FormData();
    files.forEach((file) => body.append("files", file));
    body.append("language", language);
    body.append("device", device);
    body.append("handwriting", String(handwriting));
    body.append("force_ocr", String(force));
    try {
      const result = await api<{
        documents: DocumentRecord[];
        errors: { filename: string; error: string }[];
      }>("/documents", { method: "POST", body });
      accepted.current.push(...result.documents);
      if (result.errors.length) {
        setErrors(
          result.errors.map((item) => `${item.filename}: ${item.error}`),
        );
        const names = new Set(result.errors.map((item) => item.filename));
        setFiles((current) => current.filter((file) => names.has(file.name)));
      } else {
        done(accepted.current);
      }
    } catch (error) {
      setErrors([(error as Error).message]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Add documents"
      busy={busy}
      close={() => (accepted.current.length ? done(accepted.current) : close())}
    >
      <p className="muted modal-intro">
        Bring your pages in. We’ll turn them into editable text.
      </p>
      <button
        className="upload-target"
        disabled={busy}
        onClick={() => input.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!busy) addFiles(Array.from(e.dataTransfer.files));
        }}
      >
        <span className="upload-symbol">
          <Upload size={25} />
        </span>
        <strong>Drop files here or browse</strong>
        <span>PDF, PNG, JPG · Up to {system.limits.file_mb} MB per file</span>
      </button>
      <input
        ref={input}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg"
        multiple
        hidden
        onChange={(e) => {
          addFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      {files.length > 0 && (
        <ul className="upload-files">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`}>
              <FileText size={18} />
              <span>
                {file.name}
                <small>{fileSize(file.size)}</small>
              </span>
              <button
                className="icon-button"
                aria-label={`Remove ${file.name}`}
                disabled={busy}
                onClick={() => setFiles(files.filter((_, i) => i !== index))}
              >
                <X size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="form-grid">
        <label>
          Document language
          <select
            value={language}
            disabled={busy}
            onChange={(e) => {
              setLanguage(e.target.value);
              if (!["mixed", "en"].includes(e.target.value))
                setHandwriting(false);
            }}
          >
            {system.languages.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Processing device
          <select
            value={device}
            disabled={busy}
            onChange={(e) => setDevice(e.target.value)}
          >
            <option value="auto">Auto · prefer compatible GPU</option>
            {system.devices.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="check-option">
        <input
          type="checkbox"
          checked={handwriting}
          disabled={busy || !["mixed", "en"].includes(language)}
          onChange={(e) => setHandwriting(e.target.checked)}
        />
        <span>
          Improve handwriting recognition
          <small>
            Uses a larger model for English, Chinese, and Japanese. Review
            results for accuracy.
          </small>
        </span>
      </label>
      <label className="check-option">
        <input
          type="checkbox"
          checked={force}
          disabled={busy}
          onChange={(e) => setForce(e.target.checked)}
        />
        <span>
          Always use OCR
          <small>
            Useful for PDFs with poor text layers or a mix of text and scanned
            content.
          </small>
        </span>
      </label>
      <p className="local-note">
        <ScanLine size={15} /> Models download on first use. Your documents stay
        on this computer.
      </p>
      {errors.length > 0 && (
        <div role="alert" className="error-box">
          {errors.map((error, i) => (
            <p key={i}>{error}</p>
          ))}
          {accepted.current.length > 0 && (
            <p>{accepted.current.length} document(s) added successfully.</p>
          )}
        </div>
      )}
      <div className="modal-footer">
        <span className="muted">{files.length} of 20 files</span>
        <button
          className="button primary"
          disabled={!files.length || busy}
          onClick={upload}
        >
          {busy ? (
            <LoaderCircle size={17} className="spin" />
          ) : (
            <ScanLine size={17} />
          )}
          {busy
            ? "Uploading…"
            : `Extract text${files.length ? ` from ${files.length} ${files.length === 1 ? "file" : "files"}` : ""}`}
        </button>
      </div>
    </Modal>
  );
}
