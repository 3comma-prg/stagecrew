import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&inline';

if (!GlobalWorkerOptions.workerPort) {
  GlobalWorkerOptions.workerPort = new PdfWorker();
}

type Props = {
  blob: Blob;
};

export function InvoicePdfPages({ blob }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [drawing, setDrawing] = useState(true);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    setDrawing(true);
    setError('');
    host.replaceChildren();

    const draw = async () => {
      const data = new Uint8Array(await blob.arrayBuffer());
      const pdf = await getDocument({ data }).promise;
      try {
        const width = Math.max(host.clientWidth - 24, 320);
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          if (cancelled) return;
          const page = await pdf.getPage(pageNumber);
          const base = page.getViewport({ scale: 1 });
          const scale = (width / base.width) * Math.min(window.devicePixelRatio || 1, 2);
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = `${width}px`;
          canvas.style.height = 'auto';
          canvas.className = 'max-w-full bg-white shadow-sm';
          const context = canvas.getContext('2d');
          if (!context) throw new Error('プレビューを描画できませんでした。');
          await page.render({ canvasContext: context, viewport }).promise;
          if (cancelled) return;
          host.appendChild(canvas);
        }
      } finally {
        await pdf.destroy();
      }
    };

    draw()
      .catch((drawError) => {
        if (!cancelled) setError(drawError instanceof Error ? drawError.message : 'プレビューを表示できませんでした。');
      })
      .finally(() => {
        if (!cancelled) setDrawing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [blob]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col items-center gap-4">
      {drawing && <p className="py-8 text-sm text-slate-500">プレビューを表示しています...</p>}
      {error && <p className="py-8 text-sm text-slate-600">{error}</p>}
      <div ref={hostRef} className="flex w-full flex-col items-center gap-4" />
    </div>
  );
}
