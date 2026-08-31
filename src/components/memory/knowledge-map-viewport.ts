"use client";

import { useCallback, useRef } from "react";
import type {
  Dispatch,
  PointerEvent as ReactPointerEvent,
  SetStateAction,
  WheelEvent as ReactWheelEvent,
} from "react";
import { clampZoom, type ViewState } from "./knowledge-map-data";

interface DragState {
  pointerId: number;
  clientX: number;
  clientY: number;
}

const clientToViewPoint = (svg: SVGSVGElement, clientX: number, clientY: number) => {
  const rect = svg.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
};

const zoomAround = (view: ViewState, point: { x: number; y: number }, factor: number): ViewState => {
  const nextK = clampZoom(view.k * factor);
  const worldX = (point.x - view.x) / view.k;
  const worldY = (point.y - view.y) / view.k;
  return { x: point.x - worldX * nextK, y: point.y - worldY * nextK, k: nextK };
};

export const useKnowledgeMapViewport = (
  setView: Dispatch<SetStateAction<ViewState>>,
) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);

  const onWheel = useCallback(
    (event: ReactWheelEvent<SVGSVGElement>) => {
      event.preventDefault();
      const svg = svgRef.current;
      if (!svg) return;
      const point = clientToViewPoint(svg, event.clientX, event.clientY);
      setView((current) => zoomAround(current, point, event.deltaY > 0 ? 0.92 : 1.08));
    },
    [setView],
  );

  const onPointerDown = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY };
  }, []);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current;
      const svg = svgRef.current;
      if (!drag || !svg || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.clientX;
      const dy = event.clientY - drag.clientY;
      if (Math.abs(dx) + Math.abs(dy) < 1) return;
      drag.clientX = event.clientX;
      drag.clientY = event.clientY;
      setView((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
    },
    [setView],
  );

  const onPointerUp = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId === event.pointerId) {
      dragRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const resetView = useCallback(() => setView({ x: 0, y: 0, k: 1 }), [setView]);
  const zoomBy = useCallback(
    (factor: number) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      setView((current) => zoomAround(current, center, factor));
    },
    [setView],
  );

  return { svgRef, onWheel, onPointerDown, onPointerMove, onPointerUp, resetView, zoomBy };
};
