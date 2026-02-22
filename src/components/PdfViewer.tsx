import { useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';

type PdfViewerProps = {
  pdf: PDFDocumentProxy | null;
  jumpToPage: number | null;
  onCurrentPageChange?: (page: number) => void;
};

export function PdfViewer({ pdf, jumpToPage, onCurrentPageChange }: PdfViewerProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1.1);
  const [fitWidth, setFitWidth] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Record<number, HTMLElement | null>>({});

  const pageNumbers = useMemo(
    () => (pdf ? Array.from({ length: pdf.numPages }, (_, idx) => idx + 1) : []),
    [pdf]
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [pdf]);

  useEffect(() => {
    if (!pdf) {
      return;
    }

    let cancelled = false;

    const renderPages = async () => {
      for (const pageNumber of pageNumbers) {
        const mount = pageRefs.current[pageNumber];
        if (!mount) {
          continue;
        }

        const canvas = mount.querySelector('canvas') ?? document.createElement('canvas');
        canvas.className = 'pdf-canvas';
        if (!mount.contains(canvas)) {
          mount.appendChild(canvas);
        }

        const page = await pdf.getPage(pageNumber);
        const baseViewport = page.getViewport({ scale: 1 });

        const parentWidth = mount.clientWidth || baseViewport.width;
        const appliedScale = fitWidth ? parentWidth / baseViewport.width : zoom;
        const viewport = page.getViewport({ scale: appliedScale });

        const context = canvas.getContext('2d');
        if (!context || cancelled) {
          continue;
        }

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({ canvas, canvasContext: context, viewport }).promise;

        if (cancelled) {
          return;
        }
      }
    };

    renderPages();

    return () => {
      cancelled = true;
    };
  }, [fitWidth, pageNumbers, pdf, zoom]);

  useEffect(() => {
    if (!jumpToPage || !pageRefs.current[jumpToPage]) {
      return;
    }

    pageRefs.current[jumpToPage]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setCurrentPage(jumpToPage);
  }, [jumpToPage]);

  useEffect(() => {
    if (!scrollRef.current) {
      return;
    }

    const root = scrollRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        if (!visible) {
          return;
        }

        const page = Number((visible.target as HTMLElement).dataset.page ?? 1);
        setCurrentPage(page);
        onCurrentPageChange?.(page);
      },
      {
        root,
        threshold: [0.3, 0.6, 0.9]
      }
    );

    pageNumbers.forEach((page) => {
      const element = pageRefs.current[page];
      if (element) {
        observer.observe(element);
      }
    });

    return () => observer.disconnect();
  }, [onCurrentPageChange, pageNumbers]);

  const goToPage = (page: number) => {
    const boundedPage = Math.max(1, Math.min(page, pdf?.numPages ?? 1));
    pageRefs.current[boundedPage]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setCurrentPage(boundedPage);
  };

  return (
    <section className="pdf-panel" aria-label="Schedule PDF viewer">
      <header className="pdf-toolbar" role="toolbar" aria-label="PDF controls">
        <button type="button" onClick={() => goToPage(currentPage - 1)} disabled={!pdf || currentPage <= 1}>
          Prev page
        </button>
        <span aria-live="polite">Page {currentPage}{pdf ? ` / ${pdf.numPages}` : ''}</span>
        <button
          type="button"
          onClick={() => goToPage(currentPage + 1)}
          disabled={!pdf || currentPage >= (pdf?.numPages ?? 1)}
        >
          Next page
        </button>
        <button type="button" onClick={() => setZoom((value) => Math.max(0.6, Number((value - 0.1).toFixed(1))))}>
          Zoom out
        </button>
        <button type="button" onClick={() => setZoom((value) => Math.min(3, Number((value + 0.1).toFixed(1))))}>
          Zoom in
        </button>
        <button type="button" aria-pressed={fitWidth} onClick={() => setFitWidth((value) => !value)}>
          Fit width
        </button>
      </header>

      <div className="pdf-scroll" ref={scrollRef}>
        {!pdf && <p>Loading schedule PDF…</p>}
        {pdf &&
          pageNumbers.map((pageNumber) => (
            <article
              key={pageNumber}
              data-page={pageNumber}
              className="pdf-page"
              ref={(element) => {
                pageRefs.current[pageNumber] = element;
              }}
            >
              <p className="pdf-page-label">Page {pageNumber}</p>
            </article>
          ))}
      </div>
    </section>
  );
}
