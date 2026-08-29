"use client";

import type { ChainHop } from "@/lib/inspector/types";

/**
 * The chain map.
 *
 * This is the picture that makes the argument: the artifact you were handed sits
 * at the top looking innocent, and the thing that actually steals your keys is
 * three nodes below it. A static scanner only ever sees the first node.
 */

const STATUS_STYLE: Record<
  ChainHop["status"],
  { fill: string; stroke: string; text: string; dash?: string }
> = {
  pending: { fill: "var(--bg-sunken)", stroke: "var(--border)", text: "var(--text-muted)" },
  following: { fill: "var(--color-yuzu)", stroke: "var(--color-yuzu-deep)", text: "#3d2c1e" },
  followed: { fill: "var(--color-spring)", stroke: "var(--color-spring-deep)", text: "#fff" },
  blocked: { fill: "var(--color-danger)", stroke: "var(--color-danger-deep)", text: "#fff" },
  unexplored: {
    fill: "transparent",
    stroke: "var(--text-faint)",
    text: "var(--text-muted)",
    dash: "5 4",
  },
};

const NODE_W = 190;
const NODE_H = 56;
const GAP_X = 26;
const GAP_Y = 74;
const PAD = 18;

interface Placed extends ChainHop {
  x: number;
  y: number;
}

function layout(hops: ChainHop[]): { nodes: Placed[]; width: number; height: number } {
  const byDepth = new Map<number, ChainHop[]>();
  for (const h of hops) {
    const list = byDepth.get(h.hop) ?? [];
    list.push(h);
    byDepth.set(h.hop, list);
  }

  const depths = [...byDepth.keys()].sort((a, b) => a - b);
  const widest = Math.max(1, ...depths.map((d) => byDepth.get(d)!.length));
  const width = PAD * 2 + widest * NODE_W + (widest - 1) * GAP_X;

  const nodes: Placed[] = [];
  depths.forEach((depth, row) => {
    const list = byDepth.get(depth)!;
    const rowWidth = list.length * NODE_W + (list.length - 1) * GAP_X;
    const startX = (width - rowWidth) / 2;
    list.forEach((h, i) => {
      nodes.push({ ...h, x: startX + i * (NODE_W + GAP_X), y: PAD + row * (NODE_H + GAP_Y) });
    });
  });

  const height = PAD * 2 + depths.length * NODE_H + Math.max(0, depths.length - 1) * GAP_Y;
  return { nodes, width, height };
}

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

export function ChainMap({ hops }: { hops: ChainHop[] }) {
  if (hops.length === 0) {
    return (
      <div className="flex h-full min-h-56 items-center justify-center text-sm text-[var(--text-faint)]">
        The chain appears here as Nibbles walks it.
      </div>
    );
  }

  const { nodes, width, height } = layout(hops);
  const byId = new Map(nodes.map((n) => [n.id, n]));

  return (
    <div className="overflow-x-auto">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="max-w-full"
        role="img"
        aria-label={`Instruction chain with ${hops.length} nodes`}
      >
        <defs>
          <marker id="chain-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0 0 L10 5 L0 10 z" fill="var(--border)" />
          </marker>
        </defs>

        {nodes.map((node) => {
          if (!node.parentId) return null;
          const parent = byId.get(node.parentId);
          if (!parent) return null;

          const x1 = parent.x + NODE_W / 2;
          const y1 = parent.y + NODE_H;
          const x2 = node.x + NODE_W / 2;
          const y2 = node.y;
          const mid = (y1 + y2) / 2;

          return (
            <path
              key={`edge-${node.id}`}
              d={`M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`}
              stroke="var(--border)"
              strokeWidth="2"
              fill="none"
              strokeDasharray={node.status === "unexplored" ? "5 4" : undefined}
              markerEnd="url(#chain-arrow)"
            />
          );
        })}

        {nodes.map((node, i) => {
          const style = STATUS_STYLE[node.status];
          return (
            <g key={node.id} className="animate-rise" style={{ animationDelay: `${i * 60}ms` }}>
              <title>{`${node.target}${node.outcome ? ` — ${node.outcome}` : ""}`}</title>
              <rect
                x={node.x}
                y={node.y}
                width={NODE_W}
                height={NODE_H}
                rx="14"
                fill={style.fill}
                stroke={style.stroke}
                strokeWidth="2"
                strokeDasharray={style.dash}
              />
              {node.status === "following" && (
                <rect
                  x={node.x}
                  y={node.y}
                  width={NODE_W}
                  height={NODE_H}
                  rx="14"
                  fill="none"
                  stroke={style.stroke}
                  strokeWidth="2"
                  className="animate-soft-pulse"
                />
              )}
              <text
                x={node.x + 14}
                y={node.y + 23}
                fill={style.text}
                fontSize="13"
                fontWeight="700"
                fontFamily="var(--font-display)"
              >
                {truncate(node.label, 22)}
              </text>
              <text x={node.x + 14} y={node.y + 41} fill={style.text} fontSize="11" opacity="0.82">
                {node.hop === 0 ? "the artifact" : `hop ${node.hop} · ${node.kind}`}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
