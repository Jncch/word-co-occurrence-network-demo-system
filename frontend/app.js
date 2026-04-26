const SAMPLE_TEXT = `新製品のマーケティング戦略について話しましょう。まずターゲット顧客の設定が重要だと思います。
そうですね。ターゲット顧客を明確にしてからSNSマーケティングを展開するのが効果的だと思います。
SNSマーケティングではインフルエンサーを活用する方法もありますね。インフルエンサーマーケティングは今のターゲット顧客に刺さりやすい。
ブランドイメージも大切です。ブランドイメージがSNSマーケティングと一致していないと効果が出ません。
価格設定も重要です。ターゲット顧客の購買力に合わせた価格設定が必要です。
新製品の機能についても整理しましょう。ユーザー体験とデザインは新製品の差別化要素になります。
ユーザー体験を向上させるには顧客フィードバックが欠かせません。顧客フィードバックを製品開発に活かすサイクルが大事です。
販売チャネルはどうしますか。オンライン販売とリアル店舗の両方を考えた方がいいでしょうか。
オンライン販売はSNSマーケティングと相性がいいです。まずオンライン販売から始めてデータを取るのが現実的だと思います。
販売チャネルの選択はブランドイメージとも関係します。ブランドイメージを壊さない販売チャネルを選ぶべきです。
プロモーション施策も必要ですね。キャンペーンやクーポンなどのプロモーション施策でターゲット顧客を引き付けましょう。
新製品の発売タイミングも考えないといけません。シーズンに合わせた発売タイミングがマーケティング効果を高めます。`;

const ZOOM_FACTOR = 1.25;

let networkInstance = null;
let lastGraph = null;
let elText, elWindow, elMinFreq, elMinCooc, elBtn, elAiBtn, elStatus, elStats, elNetwork, elOverlay;
let elZoomControls, elZoomIn, elZoomOut, elZoomReset;
let elAiPanel, elAiContent, elAiClose;

document.addEventListener("DOMContentLoaded", () => {
  elText = document.getElementById("text-input");
  elWindow = document.getElementById("window-size");
  elMinFreq = document.getElementById("min-freq");
  elMinCooc = document.getElementById("min-cooc");
  elBtn = document.getElementById("analyze-btn");
  elAiBtn = document.getElementById("ai-analyze-btn");
  elStatus = document.getElementById("status");
  elStats = document.getElementById("stats");
  elNetwork = document.getElementById("network");
  elOverlay = document.getElementById("overlay");
  elZoomControls = document.getElementById("zoom-controls");
  elZoomIn = document.getElementById("zoom-in");
  elZoomOut = document.getElementById("zoom-out");
  elZoomReset = document.getElementById("zoom-reset");
  elAiPanel = document.getElementById("ai-panel");
  elAiContent = document.getElementById("ai-content");
  elAiClose = document.getElementById("ai-close");

  elText.value = SAMPLE_TEXT;
  showEmpty("解析するとここに共起ネットワークが表示されます");
  elBtn.addEventListener("click", runAnalysis);
  elAiBtn.addEventListener("click", runAiAnalysis);
  elAiClose.addEventListener("click", () => { elAiPanel.hidden = true; });

  const invalidateGraph = () => {
    if (!elAiBtn.disabled) {
      lastGraph = null;
      elAiBtn.disabled = true;
    }
  };
  elText.addEventListener("input", invalidateGraph);
  elWindow.addEventListener("input", invalidateGraph);
  elMinFreq.addEventListener("input", invalidateGraph);
  elMinCooc.addEventListener("input", invalidateGraph);
  elZoomIn.addEventListener("click", () => zoomBy(ZOOM_FACTOR));
  elZoomOut.addEventListener("click", () => zoomBy(1 / ZOOM_FACTOR));
  elZoomReset.addEventListener("click", () => {
    if (networkInstance) networkInstance.fit();
  });
});

async function runAnalysis() {
  const text = elText.value.trim();
  if (!text) {
    setStatus("テキストを入力してください", true);
    return;
  }

  elBtn.disabled = true;
  setStatus("解析中...", false);
  showLoading();

  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        window_size: Number(elWindow.value),
        min_freq: Number(elMinFreq.value),
        min_cooc: Number(elMinCooc.value),
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`API error (${res.status}): ${err}`);
    }

    const data = await res.json();
    renderStats(data.stats);

    if (data.nodes.length === 0) {
      lastGraph = null;
      elAiBtn.disabled = true;
      showEmpty("グラフが空です。最小出現頻度・最小共起頻度を下げてみてください。");
      setStatus("グラフが空でした", true);
      return;
    }

    lastGraph = { nodes: data.nodes, edges: data.edges };
    elAiBtn.disabled = false;
    drawNetwork(data.nodes, data.edges);
    setStatus(`完了: ノード ${data.nodes.length} / エッジ ${data.edges.length}`, false);
  } catch (err) {
    console.error(err);
    lastGraph = null;
    elAiBtn.disabled = true;
    showEmpty("解析に失敗しました");
    setStatus(err.message || "解析に失敗しました", true);
  } finally {
    elBtn.disabled = false;
  }
}

async function runAiAnalysis() {
  if (!lastGraph || lastGraph.nodes.length === 0) {
    setStatus("先に共起ネットワークを生成してください", true);
    return;
  }

  elAiBtn.disabled = true;
  setStatus("AI解析中...", false);
  showAiLoading();

  try {
    const res = await fetch("/api/ai-analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nodes: lastGraph.nodes.map((n) => ({
          id: n.id,
          label: n.label,
          frequency: n.frequency,
        })),
        edges: lastGraph.edges,
      }),
    });

    if (!res.ok) {
      const raw = await res.text();
      let detail = raw;
      try {
        const j = JSON.parse(raw);
        if (j && j.detail) detail = j.detail;
      } catch (_) {}
      const hint =
        res.status === 503
          ? "（Geminiモデルが高負荷の可能性があります。少し待って再実行するか、.envのGEMINI_MODELを変更してください）"
          : "";
      throw new Error(`AI APIエラー (${res.status}): ${detail}${hint}`);
    }

    const data = await res.json();
    renderAiResult(data);
    setStatus("AI解析が完了しました", false);
  } catch (err) {
    console.error(err);
    renderAiError(err.message || "AI解析に失敗しました");
    setStatus(err.message || "AI解析に失敗しました", true);
  } finally {
    elAiBtn.disabled = false;
  }
}

function showAiLoading() {
  elAiPanel.hidden = false;
  elAiContent.innerHTML = `
    <div class="ai-loading">
      <div class="spinner" aria-hidden="true"></div>
      <div>AIが議論構造を分析中...</div>
    </div>
  `;
}

function renderAiError(message) {
  elAiPanel.hidden = false;
  elAiContent.innerHTML = `<div class="ai-error">${escapeHtml(message)}</div>`;
}

function renderAiResult(data) {
  const ai = data.ai || {};
  const missing = Array.isArray(ai.missing_words) ? ai.missing_words : [];
  const next = Array.isArray(ai.next_discussions)
    ? [...ai.next_discussions].sort((a, b) => (a.priority || 0) - (b.priority || 0))
    : [];

  const summaryHtml = `
    <section class="ai-section">
      <h3>現状の分析</h3>
      <div class="ai-summary">${escapeHtml(ai.current_analysis || "(なし)")}</div>
    </section>
  `;

  const missingHtml = `
    <section class="ai-section">
      <h3>欠けているワード／観点</h3>
      ${
        missing.length === 0
          ? `<div class="ai-card"><div class="ai-card__reason">特になし</div></div>`
          : missing
              .map(
                (m) => `
        <div class="ai-card">
          <div class="ai-card__title">${escapeHtml(m.category || "")}</div>
          <div class="ai-tags">${(m.keywords || [])
            .map((k) => `<span class="ai-tag">${escapeHtml(k)}</span>`)
            .join("")}</div>
          <div class="ai-card__reason">${escapeHtml(m.reason || "")}</div>
        </div>`
              )
              .join("")
      }
    </section>
  `;

  const nextHtml = `
    <section class="ai-section">
      <h3>ネクストディスカッションの提案</h3>
      ${
        next.length === 0
          ? `<div class="ai-card"><div class="ai-card__reason">特になし</div></div>`
          : next
              .map(
                (d) => `
        <div class="ai-card">
          <div class="ai-card__title">
            <span class="ai-card__priority">${escapeHtml(String(d.priority ?? "-"))}</span>
            ${escapeHtml(d.topic || "")}
          </div>
          <div class="ai-card__reason">${escapeHtml(d.reason || "")}</div>
        </div>`
              )
              .join("")
      }
    </section>
  `;

  const modelLabel =
    data.requested_model && data.model && data.requested_model !== data.model
      ? `${escapeHtml(data.model)} (フォールバック / 要求: ${escapeHtml(data.requested_model)})`
      : escapeHtml(data.model || "?");
  const meta = data.summary?.stats
    ? `<div class="ai-meta">model: ${modelLabel} ／ ノード ${data.summary.stats.node_count} / エッジ ${data.summary.stats.edge_count}</div>`
    : "";

  elAiPanel.hidden = false;
  elAiContent.innerHTML = summaryHtml + missingHtml + nextHtml + meta;
  elAiContent.scrollTop = 0;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setStatus(message, isError) {
  elStatus.textContent = message;
  elStatus.classList.toggle("error", Boolean(isError));
}

function renderStats(stats) {
  elStats.innerHTML = `
    <dl>
      <dt>分割文数</dt><dd>${stats.sentence_count}</dd>
      <dt>有効文数</dt><dd>${stats.valid_sentence_count}</dd>
      <dt>ユニーク語数</dt><dd>${stats.unique_term_count}</dd>
      <dt>ノード数</dt><dd>${stats.node_count}</dd>
      <dt>エッジ数</dt><dd>${stats.edge_count}</dd>
    </dl>
  `;
  elStats.classList.add("visible");
}

function destroyNetwork() {
  if (networkInstance) {
    networkInstance.destroy();
    networkInstance = null;
  }
  elNetwork.innerHTML = "";
  elZoomControls.hidden = true;
}

function showOverlay(html, modifier) {
  elOverlay.className = `overlay--${modifier}`;
  elOverlay.innerHTML = html;
  elOverlay.hidden = false;
}

function hideOverlay() {
  elOverlay.hidden = true;
}

function showEmpty(message) {
  destroyNetwork();
  showOverlay(message, "empty");
}

function showLoading() {
  destroyNetwork();
  showOverlay(
    `<div class="spinner" aria-hidden="true"></div><div class="overlay-text">解析中...</div>`,
    "loading"
  );
}

function zoomBy(factor) {
  if (!networkInstance) return;
  const scale = networkInstance.getScale();
  const position = networkInstance.getViewPosition();
  networkInstance.moveTo({ position, scale: scale * factor });
}

function findComponents(nodeIds, edges) {
  const adj = new Map();
  nodeIds.forEach((id) => adj.set(id, []));
  edges.forEach((e) => {
    if (adj.has(e.source) && adj.has(e.target)) {
      adj.get(e.source).push(e.target);
      adj.get(e.target).push(e.source);
    }
  });
  const visited = new Set();
  const components = [];
  for (const id of nodeIds) {
    if (visited.has(id)) continue;
    const comp = [];
    const stack = [id];
    visited.add(id);
    while (stack.length) {
      const cur = stack.pop();
      comp.push(cur);
      for (const next of adj.get(cur)) {
        if (!visited.has(next)) {
          visited.add(next);
          stack.push(next);
        }
      }
    }
    components.push(comp);
  }
  return components.sort((a, b) => b.length - a.length);
}

function hashAngle(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const range = Math.PI / 3;
  return ((h >>> 0) % 1000) / 1000 * range - range / 2;
}

function buildAdjacency(component, edges) {
  const inComp = new Set(component);
  const adj = new Map(component.map((id) => [id, []]));
  edges.forEach((e) => {
    if (inComp.has(e.source) && inComp.has(e.target)) {
      adj.get(e.source).push(e.target);
      adj.get(e.target).push(e.source);
    }
  });
  return adj;
}

function bfsOrderInSubset(subset, adj) {
  if (subset.length === 0) return [];
  const subsetSet = new Set(subset);
  const subDeg = (id) => adj.get(id).filter((n) => subsetSet.has(n)).length;
  const start = [...subset].sort((a, b) => subDeg(b) - subDeg(a))[0];
  const visited = new Set([start]);
  const order = [start];
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    const neighbors = adj.get(cur)
      .filter((n) => subsetSet.has(n))
      .sort((a, b) => subDeg(b) - subDeg(a));
    for (const next of neighbors) {
      if (!visited.has(next)) {
        visited.add(next);
        order.push(next);
        queue.push(next);
      }
    }
  }
  for (const id of subset) {
    if (!visited.has(id)) {
      visited.add(id);
      order.push(id);
    }
  }
  return order;
}

function layoutComponent(comp, edges, cx, cy) {
  const adj = buildAdjacency(comp, edges);
  const degree = (id) => adj.get(id).length;
  const positions = new Map();

  if (comp.length === 1) {
    positions.set(comp[0], { x: cx, y: cy });
    return positions;
  }

  const nonLeaves = comp.filter((id) => degree(id) > 1);
  const leaves = comp.filter((id) => degree(id) === 1);

  if (nonLeaves.length === 0) {
    const radius = 60;
    const seedAngle = hashAngle(comp.join("|"));
    comp.forEach((id, j) => {
      const angle = seedAngle + (2 * Math.PI * j) / comp.length;
      positions.set(id, {
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
      });
    });
    return positions;
  }

  const innerRadius = nonLeaves.length === 1 ? 0 : 45 + nonLeaves.length * 15;
  const order = bfsOrderInSubset(nonLeaves, adj);
  order.forEach((id, j) => {
    if (nonLeaves.length === 1) {
      positions.set(id, { x: cx, y: cy });
    } else {
      const angle = (2 * Math.PI * j) / order.length;
      positions.set(id, {
        x: cx + innerRadius * Math.cos(angle),
        y: cy + innerRadius * Math.sin(angle),
      });
    }
  });

  const leafGroups = new Map();
  leaves.forEach((id) => {
    const parent = adj.get(id)[0];
    if (!leafGroups.has(parent)) leafGroups.set(parent, []);
    leafGroups.get(parent).push(id);
  });

  if (nonLeaves.length === 1) {
    const parent = nonLeaves[0];
    const leavesOfParent = leafGroups.get(parent) || [];
    const radius = 110;
    leavesOfParent.forEach((leafId, j) => {
      const angle = (2 * Math.PI * j) / Math.max(leavesOfParent.length, 1);
      positions.set(leafId, {
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
      });
    });
  } else {
    const outerRadius = innerRadius + 90;
    const spreadStep = 0.75;
    leafGroups.forEach((leafList, parent) => {
      const ppos = positions.get(parent);
      const dx = ppos.x - cx;
      const dy = ppos.y - cy;
      const baseAngle = (Math.abs(dx) + Math.abs(dy)) < 0.001 ? 0 : Math.atan2(dy, dx);
      leafList.forEach((leafId, k) => {
        const offset = leafList.length === 1 ? 0 : (k - (leafList.length - 1) / 2) * spreadStep;
        const angle = baseAngle + offset;
        positions.set(leafId, {
          x: cx + outerRadius * Math.cos(angle),
          y: cy + outerRadius * Math.sin(angle),
        });
      });
    });
  }

  return positions;
}

function assignInitialPositions(components, edges) {
  const positions = new Map();
  const count = components.length;
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / cols);
  const spacingX = 380;
  const spacingY = 290;
  const offsetX = ((cols - 1) * spacingX) / 2;
  const offsetY = ((rows - 1) * spacingY) / 2;

  components.forEach((comp, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = col * spacingX - offsetX;
    const cy = row * spacingY - offsetY;
    const compPositions = layoutComponent(comp, edges, cx, cy);
    compPositions.forEach((pos, id) => positions.set(id, pos));
  });
  return positions;
}

function drawNetwork(nodes, edges) {
  destroyNetwork();
  showLoading();

  const nodeIds = nodes.map((n) => n.id);
  const components = findComponents(nodeIds, edges);
  const initialPositions = assignInitialPositions(components, edges);

  const maxFreq = Math.max(...nodes.map((n) => n.frequency));
  const maxWeight = Math.max(...edges.map((e) => e.weight));

  const visNodes = nodes.map((n) => {
    const ratio = n.frequency / maxFreq;
    const size = 12 + 28 * ratio;
    const colorValue = Math.round(180 - 100 * ratio);
    const pos = initialPositions.get(n.id);
    return {
      id: n.id,
      label: n.label,
      value: n.frequency,
      size,
      x: pos.x,
      y: pos.y,
      title: `${n.label} (出現頻度: ${n.frequency})`,
      color: {
        background: `rgb(${colorValue}, ${colorValue + 30}, 245)`,
        border: "#1e3a8a",
        highlight: { background: "#fbbf24", border: "#b45309" },
      },
      font: { size: 14, face: "sans-serif", color: "#111827" },
    };
  });

  const visEdges = edges.map((e) => ({
    from: e.source,
    to: e.target,
    value: e.weight,
    width: 0.5 + 4.0 * (e.weight / maxWeight),
    title: `${e.source} × ${e.target}: ${e.weight}回`,
    color: { color: "#9ca3af", highlight: "#f59e0b" },
    smooth: false,
  }));

  const data = { nodes: new vis.DataSet(visNodes), edges: new vis.DataSet(visEdges) };
  const options = {
    nodes: {
      shape: "dot",
      scaling: { min: 12, max: 40 },
    },
    edges: {
      scaling: { min: 1, max: 8 },
      smooth: false,
    },
    physics: { enabled: false },
    interaction: {
      hover: true,
      tooltipDelay: 150,
      zoomView: false,
      dragView: true,
    },
  };

  networkInstance = new vis.Network(elNetwork, data, options);
  networkInstance.fit();
  elZoomControls.hidden = false;
  hideOverlay();
}
