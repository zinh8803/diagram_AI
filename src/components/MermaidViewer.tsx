'use client';

import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

interface MermaidViewerProps {
  code: string;
  idSuffix?: string;
}

export default function MermaidViewer({ code, idSuffix = 'main' }: MermaidViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'dark',
      securityLevel: 'loose',
      fontFamily: 'Inter, system-ui, sans-serif',
      sequence: {
        actorMargin: 60,
        messageMargin: 35,
        boxMargin: 10,
        useMaxWidth: false,
      },
      er: {
        useMaxWidth: false,
        layoutDirection: 'LR',
      },
    });
  }, []);

  useEffect(() => {
    let isMounted = true;
    async function renderDiagram() {
      if (!code.trim()) return;
      try {
        setError(null);
        const renderId = `mermaid_${idSuffix}_${Date.now()}`;
        const { svg } = await mermaid.render(renderId, code);
        if (isMounted) {
          setSvgContent(svg);
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err?.message || 'Không thể render sơ đồ Mermaid');
        }
      }
    }
    renderDiagram();
    return () => {
      isMounted = false;
    };
  }, [code, idSuffix]);

  if (error) {
    return (
      <div className="p-4 rounded-xl bg-red-950/40 border border-red-800/60 text-red-200 text-xs font-mono">
        <p className="font-semibold mb-1">Lỗi cú pháp Mermaid:</p>
        <pre className="whitespace-pre-wrap">{error}</pre>
      </div>
    );
  }

  return (
    <div className="w-full h-full overflow-auto flex items-center justify-center p-6 bg-[#0b101b]">
      <div
        ref={containerRef}
        className="mermaid-svg-wrapper max-w-full"
        dangerouslySetInnerHTML={{ __html: svgContent }}
      />
    </div>
  );
}
