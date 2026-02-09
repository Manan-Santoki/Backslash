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

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

// ─── Types ──────────────────────────────────────────

interface PdfViewerProps {
  pdfUrl: string | null;
  loading: boolean;
  onTextSelect?: (text: string) => void;
}

export interface PdfViewerHandle {
  saveScrollPosition: () => void;
}

// ─── Constants ──────────────────────────────────────

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;
const ZOOM_WHEEL_SENSITIVITY = 0.002;

// ─── PdfViewer ──────────────────────────────────────

export const PdfViewer = forwardRef<PdfViewerHandle, PdfViewerProps>(function PdfViewer({ pdfUrl, loading, onTextSelect }, ref) {
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [zoom, setZoom] = useState<number>(1);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const scrollPositionRef = useRef<{ ratio: number } | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

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
        setContainerWidth(entry.contentRect.width);
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  function onDocumentLoadSuccess({ numPages: n }: { numPages: number }) {
    setNumPages(n);

    if (scrollPositionRef.current && containerRef.current) {
      const { ratio } = scrollPositionRef.current;
      // Attempt restore multiple times — pages may not be fully rendered yet
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
        if (attempts < 5) {
          requestAnimationFrame(tryRestore);
        }
      };
      requestAnimationFrame(tryRestore);
    }
  }

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
  }, [numPages]);

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

    function handleMouseUp() {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) return;

      const text = selection.toString().trim();
      if (text.length >= 3) {
        onTextSelect!(text);
      }
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
      const downloadUrl = pdfUrl.includes("?")
        ? `${pdfUrl.split("?")[0]}?download=true`
        : `${pdfUrl}?download=true`;
      window.open(downloadUrl, "_blank");
    }
  }

  const pageWidth = containerWidth > 0 ? (containerWidth - 48) * zoom : undefined;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full flex-col bg-bg-tertiary">
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
        <div ref={containerRef} className="relative flex-1 overflow-auto">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg-tertiary/80">
              <div className="flex flex-col items-center gap-2 animate-fade-in">
                <Loader2 className="h-6 w-6 animate-spin text-accent" />
                <span className="text-xs text-text-muted">Compiling...</span>
              </div>
            </div>
          )}

          {!pdfUrl && !loading && (
            <div className="flex h-full items-center justify-center animate-fade-in">
              <div className="flex flex-col items-center gap-3 text-center px-4">
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

          {pdfUrl && (
            <div className="py-4">
              <Document
                file={pdfUrl}
                onLoadSuccess={onDocumentLoadSuccess}
                loading={
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-accent" />
                  </div>
                }
                error={
                  <div className="flex items-center justify-center py-12">
                    <p className="text-sm text-error">Failed to load PDF</p>
                  </div>
                }
              >
                {Array.from(new Array(numPages), (_, index) => {
                  const pageNum = index + 1;
                  return (
                    <div
                      key={`page_${pageNum}`}
                      ref={(el) => setPageRef(pageNum, el)}
                      data-page-number={pageNum}
                      className="mb-3 flex justify-center"
                    >
                      <Page
                        pageNumber={pageNum}
                        width={pageWidth}
                        devicePixelRatio={
                          typeof window !== "undefined"
                            ? Math.max(window.devicePixelRatio || 1, 2)
                            : 2
                        }
                        renderTextLayer={true}
                        renderAnnotationLayer={false}
                      />
                    </div>
                  );
                })}
              </Document>
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
});
