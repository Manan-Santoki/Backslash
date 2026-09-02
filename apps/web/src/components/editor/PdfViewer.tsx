"use client";

import { useState, useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import {
  ZoomIn,
  ZoomOut,
  Download,
  FileText,
  Loader2,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

// ─── Types ──────────────────────────────────────────

interface PdfViewerProps {
  pdfUrl: string | null;
  loading: boolean;
  onTextSelect?: (text: string, before: string, after: string) => void;
}

export interface PdfViewerHandle {
  saveScrollPosition: () => void;
}

// ─── Constants ──────────────────────────────────────

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;
const ZOOM_WHEEL_SENSITIVITY = 0.002;
const RESIZE_DEBOUNCE_MS = 120;

interface PdfDocumentLayerProps {
  file: string;
  isActive: boolean;
  pageWidth: number | undefined;
  devicePixelRatio: number;
  onLoad: (file: string, numPages: number) => void;
  onReady: (file: string, numPages: number) => void;
  onError: (file: string) => void;
  setPageRef: (pageNum: number, element: HTMLDivElement | null) => void;
}

/**
 * A keyed document layer lets an updated PDF render off-screen while the
 * previous version remains visible. Once every page canvas is ready, React can
 * promote this same layer without remounting it or flashing an empty viewer.
 */
function PdfDocumentLayer({
  file,
  isActive,
  pageWidth,
  devicePixelRatio,
  onLoad,
  onReady,
  onError,
  setPageRef,
}: PdfDocumentLayerProps) {
  const [layerNumPages, setLayerNumPages] = useState(0);
  const renderedPagesRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    renderedPagesRef.current.clear();
  }, [file, pageWidth, devicePixelRatio]);

  const handleLoad = useCallback(
    ({ numPages }: { numPages: number }) => {
      renderedPagesRef.current.clear();
      setLayerNumPages(numPages);
      onLoad(file, numPages);
    },
    [file, onLoad]
  );

  const handlePageRender = useCallback(
    (pageNum: number) => {
      renderedPagesRef.current.add(pageNum);
      if (
        layerNumPages > 0 &&
        renderedPagesRef.current.size === layerNumPages
      ) {
        onReady(file, layerNumPages);
      }
    },
    [file, layerNumPages, onReady]
  );

  return (
    <div
      className={
        isActive
          ? "relative py-4"
          : "invisible pointer-events-none absolute inset-x-0 top-0 py-4"
      }
      aria-hidden={!isActive}
    >
      <Document
        file={file}
        onLoadSuccess={handleLoad}
        onLoadError={() => onError(file)}
        loading={
          isActive ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-accent" />
            </div>
          ) : null
        }
        error={
          isActive ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-sm text-error">Failed to load PDF</p>
            </div>
          ) : null
        }
      >
        {Array.from({ length: layerNumPages }, (_, index) => {
          const pageNum = index + 1;
          return (
            <div
              key={`page_${pageNum}`}
              ref={isActive ? (element) => setPageRef(pageNum, element) : undefined}
              data-page-number={pageNum}
              className="mb-3 flex justify-center"
            >
              <Page
                pageNumber={pageNum}
                width={pageWidth}
                devicePixelRatio={devicePixelRatio}
                renderTextLayer={true}
                renderAnnotationLayer={true}
                onRenderSuccess={() => handlePageRender(pageNum)}
                loading={null}
              />
            </div>
          );
        })}
      </Document>
    </div>
  );
}

// ─── PdfViewer ──────────────────────────────────────

export const PdfViewer = forwardRef<PdfViewerHandle, PdfViewerProps>(function PdfViewer({ pdfUrl, loading, onTextSelect }, ref) {
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [activePdfUrl, setActivePdfUrl] = useState<string | null>(pdfUrl);
  const [pendingPdfUrl, setPendingPdfUrl] = useState<string | null>(null);
  const [pdfRefreshError, setPdfRefreshError] = useState(false);
  const [zoom, setZoom] = useState<number>(1);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const scrollPositionRef = useRef<{ ratio: number } | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerWidthRef = useRef(0);

  const zoomPercent = Math.round(zoom * 100);

  // Expose saveScrollPosition so parent can call it before triggering a rebuild
  useImperativeHandle(ref, () => ({
    saveScrollPosition: () => {
      const container = containerRef.current;
      if (!container) return;
      const { scrollTop, scrollHeight, clientHeight } = container;
      if (scrollHeight > clientHeight) {
        scrollPositionRef.current = {
          ratio: scrollTop / (scrollHeight - clientHeight),
        };
      }
    },
  }), []);

  // Measure container width for fit-to-width
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const nextWidth = entry.contentRect.width;
        if (Math.abs(nextWidth - containerWidthRef.current) < 1) continue;

        if (containerWidthRef.current === 0) {
          containerWidthRef.current = nextWidth;
          setContainerWidth(nextWidth);
          continue;
        }

        if (resizeTimeoutRef.current) {
          clearTimeout(resizeTimeoutRef.current);
        }
        resizeTimeoutRef.current = setTimeout(() => {
          containerWidthRef.current = nextWidth;
          setContainerWidth(nextWidth);
          resizeTimeoutRef.current = null;
        }, RESIZE_DEBOUNCE_MS);
      }
    });
    ro.observe(container);
    return () => {
      ro.disconnect();
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setPdfRefreshError(false);
    if (!pdfUrl) {
      observerRef.current?.disconnect();
      pageRefs.current.clear();
      setActivePdfUrl(null);
      setPendingPdfUrl(null);
      setNumPages(0);
      setCurrentPage(1);
      return;
    }

    if (!activePdfUrl) {
      setActivePdfUrl(pdfUrl);
      return;
    }

    if (pdfUrl !== activePdfUrl) {
      setPendingPdfUrl(pdfUrl);
    }
  }, [activePdfUrl, pdfUrl]);

  const restoreScrollPosition = useCallback(() => {
    if (scrollPositionRef.current && containerRef.current) {
      const { ratio } = scrollPositionRef.current;
      let attempts = 0;
      const tryRestore = () => {
        const container = containerRef.current;
        if (!container) return;
        const { scrollHeight, clientHeight } = container;
        if (scrollHeight > clientHeight) {
          container.scrollTop = ratio * (scrollHeight - clientHeight);
        }
        attempts++;
        // Retry a few times as pages render incrementally
        if (attempts < 20) {
          setTimeout(() => requestAnimationFrame(tryRestore), 50);
        }
      };
      requestAnimationFrame(tryRestore);
    }
  }, []);

  const handleDocumentLoad = useCallback(
    (file: string, nextNumPages: number) => {
      if (file === activePdfUrl) {
        setNumPages(nextNumPages);
      }
    },
    [activePdfUrl]
  );

  const handleDocumentReady = useCallback(
    (file: string, nextNumPages: number) => {
      if (file === pendingPdfUrl) {
        pageRefs.current.clear();
        setNumPages(nextNumPages);
        setCurrentPage((page) => Math.min(page, nextNumPages));
        setActivePdfUrl(file);
        setPendingPdfUrl(null);
        requestAnimationFrame(restoreScrollPosition);
      } else if (file === activePdfUrl) {
        restoreScrollPosition();
      }
    },
    [activePdfUrl, pendingPdfUrl, restoreScrollPosition]
  );

  const handleDocumentError = useCallback(
    (file: string) => {
      if (file === pendingPdfUrl) {
        setPendingPdfUrl(null);
        setPdfRefreshError(true);
      }
    },
    [pendingPdfUrl]
  );

  // IntersectionObserver for page tracking
  const setPageRef = useCallback(
    (pageNum: number, el: HTMLDivElement | null) => {
      if (el) {
        pageRefs.current.set(pageNum, el);
      } else {
        pageRefs.current.delete(pageNum);
      }
    },
    []
  );

  useEffect(() => {
    if (!containerRef.current || numPages === 0) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        let maxRatio = 0;
        let visiblePage = 1;

        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio > maxRatio) {
            maxRatio = entry.intersectionRatio;
            const pageNum = parseInt(
              entry.target.getAttribute("data-page-number") ?? "1",
              10
            );
            visiblePage = pageNum;
          }
        });

        if (maxRatio > 0) {
          setCurrentPage(visiblePage);
        }
      },
      {
        root: containerRef.current,
        threshold: [0, 0.25, 0.5, 0.75, 1],
      }
    );

    pageRefs.current.forEach((el) => {
      observerRef.current?.observe(el);
    });

    return () => {
      observerRef.current?.disconnect();
    };
  }, [activePdfUrl, numPages]);

  // Trackpad / Ctrl+Wheel zoom
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function handleWheel(e: WheelEvent) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = -e.deltaY * ZOOM_WHEEL_SENSITIVITY;
        setZoom((prev) => {
          const next = prev + delta * prev;
          return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
        });
      }
    }

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, []);

  // PDF text selection → sync to editor
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !onTextSelect) return;

    function normalize(s: string) {
      return s.replace(/-\s*\n\s*/g, "").replace(/\s+/g, " ").trim();
    }

    function findTextLayer(node: Node | null): Element | null {
      let cur: Node | null = node;
      while (cur) {
        if (cur instanceof Element) {
          const cls = cur.className;
          if (typeof cls === "string" && /textLayer|textContent/.test(cls)) {
            return cur;
          }
        }
        cur = cur.parentNode;
      }
      return null;
    }

    function handleMouseUp() {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;

      const range = selection.getRangeAt(0);
      const text = normalize(selection.toString());
      if (text.length < 3) return;

      const CTX = 80;
      let before = "";
      let after = "";
      const layer = findTextLayer(range.startContainer);
      if (layer) {
        try {
          const beforeRange = document.createRange();
          beforeRange.setStart(layer, 0);
          beforeRange.setEnd(range.startContainer, range.startOffset);
          before = normalize(beforeRange.toString()).slice(-CTX);

          const afterLayer = findTextLayer(range.endContainer) || layer;
          const afterRange = document.createRange();
          afterRange.setStart(range.endContainer, range.endOffset);
          afterRange.setEnd(afterLayer, afterLayer.childNodes.length);
          after = normalize(afterRange.toString()).slice(0, CTX);
        } catch {
          // Ignore range errors (cross-page selections, etc.)
        }
      }

      onTextSelect!(text, before, after);
    }

    container.addEventListener("mouseup", handleMouseUp);
    return () => container.removeEventListener("mouseup", handleMouseUp);
  }, [onTextSelect]);

  function handleZoomIn() {
    setZoom((prev) => Math.min(prev + ZOOM_STEP, MAX_ZOOM));
  }

  function handleZoomOut() {
    setZoom((prev) => Math.max(prev - ZOOM_STEP, MIN_ZOOM));
  }

  function handleZoomReset() {
    setZoom(1);
  }

  function handlePrevPage() {
    if (currentPage <= 1) return;
    const target = currentPage - 1;
    setCurrentPage(target);
    pageRefs.current.get(target)?.scrollIntoView({ behavior: "smooth" });
  }

  function handleNextPage() {
    if (currentPage >= numPages) return;
    const target = currentPage + 1;
    setCurrentPage(target);
    pageRefs.current.get(target)?.scrollIntoView({ behavior: "smooth" });
  }

  function handleDownload() {
    if (pdfUrl) {
      const [base, query = ""] = pdfUrl.split("?");
      const params = new URLSearchParams(query);
      params.set("download", "true");
      const nextQuery = params.toString();
      const downloadUrl = nextQuery ? `${base}?${nextQuery}` : `${base}?download=true`;
      window.open(downloadUrl, "_blank");
    }
  }

  const pageWidth = containerWidth > 0
    ? Math.max(containerWidth - 48, 200) * zoom
    : undefined;
  const devicePixelRatio = typeof window !== "undefined"
    ? Math.min(Math.max(window.devicePixelRatio || 1, 1), 2)
    : 2;
  const documentUrls: string[] = [];
  if (activePdfUrl) documentUrls.push(activePdfUrl);
  if (pendingPdfUrl && pendingPdfUrl !== activePdfUrl) {
    documentUrls.push(pendingPdfUrl);
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full min-h-0 flex-col bg-bg-tertiary">
        {/* PDF Toolbar */}
        <div className="flex items-center justify-between border-b border-border bg-bg-secondary px-3 py-1.5">
          <span className="text-xs font-medium text-text-muted">Preview</span>

          <div className="flex items-center gap-1">
            {numPages > 0 && (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={handlePrevPage}
                      disabled={currentPage <= 1}
                      className="rounded p-1 text-text-muted transition-colors hover:text-text-primary hover:bg-bg-elevated disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Previous page</TooltipContent>
                </Tooltip>

                <span className="min-w-[48px] text-center text-xs text-text-secondary tabular-nums">
                  {currentPage} / {numPages}
                </span>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={handleNextPage}
                      disabled={currentPage >= numPages}
                      className="rounded p-1 text-text-muted transition-colors hover:text-text-primary hover:bg-bg-elevated disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Next page</TooltipContent>
                </Tooltip>

                <div className="mx-1 h-4 w-px bg-border" />
              </>
            )}

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleZoomOut}
                  disabled={zoom <= MIN_ZOOM}
                  className="rounded p-1 text-text-muted transition-colors hover:text-text-primary hover:bg-bg-elevated disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Zoom out</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleZoomReset}
                  className="min-w-[40px] rounded px-1 py-0.5 text-center text-xs text-text-secondary tabular-nums transition-colors hover:text-text-primary hover:bg-bg-elevated"
                >
                  {zoomPercent}%
                </button>
              </TooltipTrigger>
              <TooltipContent>Reset zoom</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleZoomIn}
                  disabled={zoom >= MAX_ZOOM}
                  className="rounded p-1 text-text-muted transition-colors hover:text-text-primary hover:bg-bg-elevated disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Zoom in</TooltipContent>
            </Tooltip>

            <div className="mx-1 h-4 w-px bg-border" />

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={!pdfUrl}
                  className="rounded p-1 text-text-muted transition-colors hover:text-text-primary hover:bg-bg-elevated disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Download PDF</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* PDF Content */}
        <div className="relative flex-1 min-h-0 overflow-hidden">
          {loading && !activePdfUrl && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-bg-tertiary/80">
              <div className="flex flex-col items-center gap-2 animate-fade-in">
                <Loader2 className="h-6 w-6 animate-spin text-accent" />
                <span className="text-xs text-text-muted">Compiling...</span>
              </div>
            </div>
          )}

          {!loading && pdfUrl && !activePdfUrl && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-bg-tertiary">
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-6 w-6 animate-spin text-accent" />
                <span className="text-xs text-text-muted">Rendering preview...</span>
              </div>
            </div>
          )}

          {activePdfUrl && (loading || pendingPdfUrl) && (
            <div className="pointer-events-none absolute right-3 top-3 z-10 flex items-center gap-2 rounded-md border border-border bg-bg-secondary/95 px-2.5 py-1.5 shadow-sm">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
              <span className="text-xs text-text-muted">
                {pendingPdfUrl ? "Rendering preview..." : "Compiling..."}
              </span>
            </div>
          )}

          {activePdfUrl && pdfRefreshError && (
            <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-md border border-error/30 bg-bg-secondary/95 px-3 py-1.5 text-xs text-error shadow-sm">
              Could not refresh the PDF preview. The previous version is still shown.
            </div>
          )}

          <div ref={containerRef} className="h-full min-h-0 overflow-auto overscroll-contain">
            {!activePdfUrl && !pdfUrl && !loading && (
              <div className="flex h-full items-center justify-center animate-fade-in">
                <div className="flex flex-col items-center gap-3 px-4 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-bg-elevated">
                    <FileText className="h-7 w-7 text-text-muted" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-text-secondary">
                      No PDF preview
                    </p>
                    <p className="mt-1 text-xs text-text-muted">
                      Hit Compile or enable auto-compile to generate a PDF
                    </p>
                  </div>
                </div>
              </div>
            )}

            {activePdfUrl && (
              <div className="relative min-h-full">
                {documentUrls.map((file) => (
                  <PdfDocumentLayer
                    key={file}
                    file={file}
                    isActive={file === activePdfUrl}
                    pageWidth={pageWidth}
                    devicePixelRatio={devicePixelRatio}
                    onLoad={handleDocumentLoad}
                    onReady={handleDocumentReady}
                    onError={handleDocumentError}
                    setPageRef={setPageRef}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
});
