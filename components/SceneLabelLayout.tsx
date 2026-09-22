"use client";

import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import { placeScreenLabels, type ScreenLabel } from "@/utils/screenLabels";

export default function SceneLabelLayout() {
  const { gl, camera, size } = useThree();
  const elapsed = useRef(0);
  useFrame((_, delta) => {
    elapsed.current += delta;
    if (elapsed.current < 1 / 20) return;
    elapsed.current = 0;
    const surface = gl.domElement.closest('[data-audit-surface="animation-scene-3d"]');
    if (!surface) return;
    const canvasBox = gl.domElement.getBoundingClientRect();
    const elements = [...surface.querySelectorAll<HTMLElement>("[data-audit-scene-label]")];
    const labels: ScreenLabel[] = elements.map(element => {
      const box = element.getBoundingClientRect();
      return {
        id: element.dataset.labelId!,
        x: box.left - canvasBox.left - Number(element.dataset.shiftX || 0),
        y: box.top - canvasBox.top - Number(element.dataset.shiftY || 0),
        width: box.width,
        height: box.height,
        priority: Number(element.dataset.priority || 0),
      };
    });
    const placements = new Map(placeScreenLabels(labels, size.width, size.height, [
      { x: size.width - 62, y: 6, width: 56, height: 56 },
    ]).map(label => [label.id, label]));
    for (let i = 0; i < elements.length; i += 1) {
      const element = elements[i];
      const initial = labels[i];
      const placed = placements.get(initial.id)!;
      const dx = placed.x - initial.x;
      const dy = placed.y - initial.y;
      element.style.transform = `translate(${dx}px, ${dy}px)`;
      element.dataset.shiftX = String(dx);
      element.dataset.shiftY = String(dy);
      element.dataset.unresolvedOverlap = String(placed.unresolved);
      const leader = element.parentElement?.querySelector("line");
      if (leader) {
        const anchor = new Vector3(Number(element.dataset.anchorX), Number(element.dataset.anchorY), Number(element.dataset.anchorZ)).project(camera);
        const ax = (anchor.x + 1) * size.width / 2;
        const ay = (1 - anchor.y) * size.height / 2;
        const x = Math.max(placed.x, Math.min(ax, placed.x + placed.width));
        const y = Math.max(placed.y, Math.min(ay, placed.y + placed.height));
        leader.setAttribute("x1", String(ax - initial.x));
        leader.setAttribute("y1", String(ay - initial.y));
        leader.setAttribute("x2", String(x - initial.x));
        leader.setAttribute("y2", String(y - initial.y));
        leader.style.opacity = Math.hypot(dx, dy) > 8 ? "0.55" : "0";
      }
    }
  });
  return null;
}
