// ========================================
// StepFlow - Popup Script
// ========================================

// --- State ---
let workflows = [];
let activeWorkflowId = null;
let isRunning = false;
let hasRunnerResults = false;
let elapsedTimerId = null;
let elapsedStartTime = null;
let stepTimerId = null;
let stepStartTime = null;

// --- DOM Elements ---
const els = {
  workflowSelect: document.getElementById("workflow-select"),
  workflowList: document.getElementById("workflow-list"),
  workflowReorder: document.getElementById("workflow-reorder"),
  btnReorderWorkflow: document.getElementById("btn-reorder-workflow"),
  btnReorderDone: document.getElementById("btn-reorder-done"),
  btnNewWorkflow: document.getElementById("btn-new-workflow"),
  btnDeleteWorkflow: document.getElementById("btn-delete-workflow"),
  workflowName: document.getElementById("workflow-name"),
  workflowInterval: document.getElementById("workflow-interval"),
  stepsContainer: document.getElementById("steps-container"),
  btnAddStep: document.getElementById("btn-add-step"),
  btnRun: document.getElementById("btn-run"),
  btnStop: document.getElementById("btn-stop"),
  workflowStopOnError: document.getElementById("workflow-stop-on-error"),
  btnDuplicateWorkflow: document.getElementById("btn-duplicate-workflow"),
  btnExport: document.getElementById("btn-export"),
  btnImport: document.getElementById("btn-import"),
  fileImport: document.getElementById("file-import"),
  editorMode: document.getElementById("editor-mode"),
  runnerPanel: document.getElementById("runner-panel"),
  progressText: document.getElementById("progress-text"),
  progressFill: document.getElementById("progress-fill"),
  stepStatusList: document.getElementById("step-status-list"),
  runnerResult: document.getElementById("runner-result"),
  copyResult: document.getElementById("copy-result"),
  elapsedTime: document.getElementById("elapsed-time"),
  btnCopyResult: document.getElementById("btn-copy-result"),
  runnerPanelHeader: document.getElementById("runner-panel-header"),
  runnerPanelBody: document.getElementById("runner-panel-body"),
  runnerToggleLabel: document.getElementById("runner-toggle-label"),
};

// --- Utility ---
function generateId() {
  return "id-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

function getActiveWorkflow() {
  return workflows.find((w) => w.id === activeWorkflowId) || null;
}

// --- Storage ---
async function loadFromStorage() {
  const data = await chrome.storage.local.get([
    "workflows",
    "activeWorkflowId",
  ]);
  workflows = data.workflows || [];
  activeWorkflowId = data.activeWorkflowId || null;

  if (workflows.length === 0) {
    // 初期ワークフローをデータのみ作成（renderAllは呼び出し元に任せる）
    const workflow = {
      id: generateId(),
      name: "新規ワークフロー",
      interval: 500,
      steps: [],
    };
    workflows.push(workflow);
    activeWorkflowId = workflow.id;
    await saveToStorage();
  } else if (
    !activeWorkflowId ||
    !workflows.find((w) => w.id === activeWorkflowId)
  ) {
    activeWorkflowId = workflows[0].id;
  }
}

async function saveToStorage() {
  await chrome.storage.local.set({ workflows, activeWorkflowId });
}

// --- Workflow CRUD ---
function createNewWorkflow() {
  const workflow = {
    id: generateId(),
    name: "新規ワークフロー",
    interval: 500,
    steps: [],
  };
  workflows.push(workflow);
  activeWorkflowId = workflow.id;
  saveToStorage();
  renderAll();
}

function duplicateActiveWorkflow() {
  const wf = getActiveWorkflow();
  if (!wf) return;
  const copy = JSON.parse(JSON.stringify(wf));
  copy.id = generateId();
  copy.name = wf.name + " (コピー)";
  workflows.push(copy);
  activeWorkflowId = copy.id;
  saveToStorage();
  renderAll();
}

function deleteActiveWorkflow() {
  if (workflows.length <= 1) return;
  const idx = workflows.findIndex((w) => w.id === activeWorkflowId);
  workflows.splice(idx, 1);
  activeWorkflowId = workflows[0].id;
  saveToStorage();
  renderAll();
}

function switchWorkflow(id) {
  activeWorkflowId = id;
  saveToStorage();
  renderAll();
}

// --- Step CRUD ---
function addStep() {
  const wf = getActiveWorkflow();
  if (!wf) return;
  wf.steps.push({
    id: generateId(),
    type: "click",
    selector: "",
  });
  saveToStorage();
  renderSteps();
}

function duplicateStep(stepId) {
  const wf = getActiveWorkflow();
  if (!wf) return;
  const idx = wf.steps.findIndex((s) => s.id === stepId);
  if (idx === -1) return;
  const clone = { ...wf.steps[idx], id: generateId() };
  wf.steps.splice(idx + 1, 0, clone);
  saveToStorage();
  renderSteps();
}

function removeStep(stepId) {
  const wf = getActiveWorkflow();
  if (!wf) return;
  wf.steps = wf.steps.filter((s) => s.id !== stepId);
  saveToStorage();
  renderSteps();
}

function moveStep(stepId, direction) {
  const wf = getActiveWorkflow();
  if (!wf) return;
  const idx = wf.steps.findIndex((s) => s.id === stepId);
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= wf.steps.length) return;
  const tmp = wf.steps[idx];
  wf.steps[idx] = wf.steps[newIdx];
  wf.steps[newIdx] = tmp;
  saveToStorage();
  renderSteps();
}

function updateStep(stepId, field, value) {
  const wf = getActiveWorkflow();
  if (!wf) return;
  const step = wf.steps.find((s) => s.id === stepId);
  if (!step) return;

  if (field === "type") {
    step.type = value;
    // type変更時にフィールドを整理
    if (value === "click" || value === "hover") {
      delete step.value;
      delete step.label;
    } else if (value === "input") {
      step.value = step.value || "";
      delete step.label;
    } else if (value === "copy") {
      delete step.value;
      step.label = step.label || "";
    }
  } else if (field === "interval") {
    // 空欄→null（全体設定を使用）、数値→number
    const parsedInterval = parseInt(value, 10);
    step.interval =
      value === "" || isNaN(parsedInterval) ? null : parsedInterval;
  } else if (field === "selectorIndex") {
    // 空欄→null（1番目を使用）、数値→number
    const parsedIndex = parseInt(value, 10);
    step.selectorIndex =
      value === "" || isNaN(parsedIndex) ? null : parsedIndex;
  } else {
    step[field] = value;
  }

  saveToStorage();
  if (field === "type") {
    renderSteps();
  }
}

// --- Rendering ---
function renderAll() {
  renderWorkflowSelect();
  renderWorkflowFields();
  renderSteps();
}

function renderWorkflowSelect() {
  // セレクトボックス
  els.workflowSelect.innerHTML = "";
  workflows.forEach((wf) => {
    const opt = document.createElement("option");
    opt.value = wf.id;
    opt.textContent = wf.name;
    if (wf.id === activeWorkflowId) opt.selected = true;
    els.workflowSelect.appendChild(opt);
  });
  // 並べ替えリスト（開いている場合）
  if (!els.workflowReorder.classList.contains("hidden")) {
    renderWorkflowReorderList();
  }
}

function renderWorkflowReorderList() {
  els.workflowList.innerHTML = "";
  workflows.forEach((wf) => {
    const item = document.createElement("div");
    item.className = "workflow-item";
    item.dataset.workflowId = wf.id;
    item.innerHTML = `<span class="workflow-drag-handle" title="ドラッグで並べ替え">⠿</span><span class="workflow-item-name">${escapeAttr(wf.name)}</span>`;
    bindWorkflowDragEvents(item);
    els.workflowList.appendChild(item);
  });
}

function toggleWorkflowReorder() {
  const isHidden = els.workflowReorder.classList.contains("hidden");
  if (isHidden) {
    els.workflowReorder.classList.remove("hidden");
    renderWorkflowReorderList();
  } else {
    els.workflowReorder.classList.add("hidden");
  }
}

// --- Workflow Drag & Drop ---
let draggedWorkflow = null;

function bindWorkflowDragEvents(item) {
  const handle = item.querySelector(".workflow-drag-handle");

  handle.addEventListener("mousedown", () => {
    item.draggable = true;
  });

  item.addEventListener("dragstart", (e) => {
    draggedWorkflow = item;
    item.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
  });

  item.addEventListener("dragend", () => {
    item.draggable = false;
    item.classList.remove("dragging");
    els.workflowList
      .querySelectorAll(".drop-above, .drop-below")
      .forEach((el) => {
        el.classList.remove("drop-above", "drop-below");
      });
    draggedWorkflow = null;
  });

  item.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!draggedWorkflow || draggedWorkflow === item) return;

    els.workflowList
      .querySelectorAll(".drop-above, .drop-below")
      .forEach((el) => {
        el.classList.remove("drop-above", "drop-below");
      });

    const rect = item.getBoundingClientRect();
    const above = e.clientY < rect.top + rect.height / 2;
    item.classList.add(above ? "drop-above" : "drop-below");
  });

  item.addEventListener("dragleave", () => {
    item.classList.remove("drop-above", "drop-below");
  });

  item.addEventListener("drop", (e) => {
    e.preventDefault();
    if (!draggedWorkflow || draggedWorkflow === item) return;

    const fromIdx = workflows.findIndex(
      (w) => w.id === draggedWorkflow.dataset.workflowId,
    );
    const toIdx = workflows.findIndex((w) => w.id === item.dataset.workflowId);
    if (fromIdx === -1 || toIdx === -1) return;

    const rect = item.getBoundingClientRect();
    const above = e.clientY < rect.top + rect.height / 2;

    const [moved] = workflows.splice(fromIdx, 1);
    let adjustedTo = toIdx > fromIdx ? toIdx - 1 : toIdx;
    const insertIdx = above ? adjustedTo : adjustedTo + 1;
    workflows.splice(insertIdx, 0, moved);

    draggedWorkflow = null;
    saveToStorage();
    renderWorkflowSelect();
  });
}

function renderWorkflowFields() {
  const wf = getActiveWorkflow();
  if (!wf) return;
  els.workflowName.value = wf.name;
  els.workflowInterval.value = wf.interval;
  els.workflowStopOnError.checked = !!wf.stopOnError;
}

function renderSteps() {
  const wf = getActiveWorkflow();
  els.stepsContainer.innerHTML = "";
  if (!wf) return;

  wf.steps.forEach((step, idx) => {
    const card = document.createElement("div");
    card.className = "step-card";
    card.dataset.stepId = step.id;
    card.innerHTML = buildStepCardHTML(step, idx);
    els.stepsContainer.appendChild(card);
    bindStepEvents(card, step);
    bindDragEvents(card);
  });
}

function buildStepCardHTML(step, idx) {
  let fieldsHTML = "";

  // Type select
  fieldsHTML += `
    <div class="step-field">
      <label>タイプ</label>
      <select data-field="type">
        <option value="click" ${step.type === "click" ? "selected" : ""}>クリック</option>
        <option value="hover" ${step.type === "hover" ? "selected" : ""}>ホバー</option>
        <option value="input" ${step.type === "input" ? "selected" : ""}>入力</option>
        <option value="copy" ${step.type === "copy" ? "selected" : ""}>コピー</option>
      </select>
    </div>
  `;

  // Selector
  fieldsHTML += `
    <div class="step-field">
      <label>セレクタ (CSS)</label>
      <div class="selector-row">
        <input type="text" data-field="selector" value="${escapeAttr(step.selector || "")}" placeholder="例: #submit-btn, .form-input">
        <button type="button" class="btn-pick" data-action="pick" title="ページ上で要素を選択">選択</button>
        <button type="button" class="btn-observe" data-action="observe" title="DOM監視で要素を検出">監視</button>
      </div>
    </div>
  `;

  // Type-specific fields
  if (step.type === "input") {
    const multiline = step.multiline || false;
    fieldsHTML += `
      <div class="step-field">
        <div class="value-label-row">
          <label>入力値</label>
          <button type="button" class="btn-multiline-toggle" data-action="toggle-multiline" title="${multiline ? "1行入力に切替" : "複数行入力に切替"}">
            ${multiline ? "1行" : "複数行"}
          </button>
        </div>
        ${
          multiline
            ? `<textarea data-field="value" placeholder="入力するテキスト" rows="4">${escapeAttr(step.value || "")}</textarea>`
            : `<input type="text" data-field="value" value="${escapeAttr(step.value || "")}" placeholder="入力するテキスト">`
        }
      </div>
    `;
  }

  if (step.type === "copy") {
    fieldsHTML += `
      <div class="step-field">
        <label>ラベル (任意)</label>
        <input type="text" data-field="label" value="${escapeAttr(step.label || "")}" placeholder="">
      </div>
    `;
  }

  // オプション（折りたたみ）
  const hasOptions =
    (step.selectorIndex != null && step.selectorIndex !== "") ||
    (step.interval != null && step.interval !== "");
  fieldsHTML += `
    <div class="step-options">
      <button type="button" class="step-options-toggle" data-action="toggle-options">
        <span class="step-options-arrow">${hasOptions ? "▼" : "▶"}</span> オプション
        ${hasOptions ? '<span class="step-options-badge">設定あり</span>' : ""}
      </button>
      <div class="step-options-body${hasOptions ? "" : " hidden"}">
        <div class="step-field">
          <label>N番目の要素　※同じセレクタが複数ある場合（未設定なら1番目）</label>
          <input type="number" data-field="selectorIndex" value="${step.selectorIndex != null ? step.selectorIndex : ""}" placeholder="1" min="1" step="1">
        </div>
        <div class="step-field">
          <label>次のステップまでの間隔 (ms)　※未設定なら全体の間隔を使用</label>
          <input type="number" data-field="interval" value="${step.interval != null ? step.interval : ""}" placeholder="全体設定を使用" min="0" step="100">
        </div>
      </div>
    </div>
  `;

  return `
    <div class="step-card-header">
      <span class="drag-handle" title="ドラッグで並べ替え">⠿</span>
      <span class="step-number">Step ${idx + 1}</span>
      <div class="step-card-actions">
        <button data-action="up" title="上へ">&uarr;</button>
        <button data-action="down" title="下へ">&darr;</button>
        <button data-action="duplicate" title="複製">複製</button>
        <button data-action="delete" title="削除">&times;</button>
      </div>
    </div>
    ${fieldsHTML}
  `;
}

function escapeAttr(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function bindStepEvents(card, step) {
  // Action buttons
  card
    .querySelector('[data-action="up"]')
    .addEventListener("click", () => moveStep(step.id, -1));
  card
    .querySelector('[data-action="down"]')
    .addEventListener("click", () => moveStep(step.id, 1));
  card
    .querySelector('[data-action="duplicate"]')
    .addEventListener("click", () => duplicateStep(step.id));
  card
    .querySelector('[data-action="delete"]')
    .addEventListener("click", () => removeStep(step.id));
  card
    .querySelector('[data-action="pick"]')
    .addEventListener("click", () => startPicker(step.id));
  card
    .querySelector('[data-action="observe"]')
    .addEventListener("click", () => startObserver(step.id));

  // Options toggle
  card
    .querySelector('[data-action="toggle-options"]')
    .addEventListener("click", (e) => {
      const btn = e.currentTarget;
      const body = btn.nextElementSibling;
      const arrow = btn.querySelector(".step-options-arrow");
      body.classList.toggle("hidden");
      arrow.textContent = body.classList.contains("hidden") ? "▶" : "▼";
    });

  // Multiline toggle
  const multilineBtn = card.querySelector('[data-action="toggle-multiline"]');
  if (multilineBtn) {
    multilineBtn.addEventListener("click", () => {
      step.multiline = !step.multiline;
      saveToStorage();
      renderSteps();
    });
  }

  // Field changes
  card.querySelectorAll("[data-field]").forEach((el) => {
    const field = el.dataset.field;
    const event = el.tagName === "SELECT" ? "change" : "input";
    el.addEventListener(event, () => {
      updateStep(step.id, field, el.value);
    });
  });
}

// --- Drag & Drop ---
let draggedCard = null;

// ドロップ後の挿入位置を計算し、移動が実際に発生するか判定する
function calcDrop(dragCard, targetCard, clientY) {
  const wf = getActiveWorkflow();
  if (!wf) return null;

  const fromIdx = wf.steps.findIndex((s) => s.id === dragCard.dataset.stepId);
  const toIdx = wf.steps.findIndex((s) => s.id === targetCard.dataset.stepId);
  if (fromIdx === -1 || toIdx === -1) return null;

  const rect = targetCard.getBoundingClientRect();
  const above = clientY < rect.top + rect.height / 2;

  // splice(fromIdx,1) 後のインデックスを考慮して挿入位置を求める
  let adjustedTo = toIdx > fromIdx ? toIdx - 1 : toIdx;
  const insertIdx = above ? adjustedTo : adjustedTo + 1;

  // 移動なしなら null
  if (insertIdx === fromIdx) return null;
  return { insertIdx, above };
}

function bindDragEvents(card) {
  const handle = card.querySelector(".drag-handle");

  handle.addEventListener("mousedown", () => {
    card.draggable = true;
  });

  card.addEventListener("dragstart", (e) => {
    draggedCard = card;
    card.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
  });

  card.addEventListener("dragend", () => {
    card.draggable = false;
    card.classList.remove("dragging");
    clearDropIndicators();
    draggedCard = null;
  });

  card.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!draggedCard || draggedCard === card) return;

    clearDropIndicators();
    const result = calcDrop(draggedCard, card, e.clientY);
    if (!result) return;

    card.classList.add(result.above ? "drop-above" : "drop-below");
  });

  card.addEventListener("dragleave", () => {
    card.classList.remove("drop-above", "drop-below");
  });

  card.addEventListener("drop", (e) => {
    e.preventDefault();
    if (!draggedCard || draggedCard === card) return;

    const result = calcDrop(draggedCard, card, e.clientY);
    if (!result) return;

    const wf = getActiveWorkflow();
    if (!wf) return;

    const fromIdx = wf.steps.findIndex(
      (s) => s.id === draggedCard.dataset.stepId,
    );
    const [moved] = wf.steps.splice(fromIdx, 1);
    wf.steps.splice(result.insertIdx, 0, moved);
    draggedCard = null;

    saveToStorage();
    renderSteps();
  });
}

function clearDropIndicators() {
  els.stepsContainer
    .querySelectorAll(".drop-above, .drop-below")
    .forEach((el) => {
      el.classList.remove("drop-above", "drop-below");
    });
}

// --- DOM Observer ---
let observerTargetStepId = null;
let observerElements = [];
const observerPanel = document.getElementById("observer-panel");
const observerElementsContainer = document.getElementById("observer-elements");
const observerCountEl = document.getElementById("observer-count");

function startObserver(stepId) {
  observerTargetStepId = stepId;
  observerElements = [];
  renderObserverElements();
  chrome.runtime.sendMessage({ type: "START_OBSERVER" }, (response) => {
    if (response && !response.success) {
      alert("DOM監視エラー: " + response.error);
      observerTargetStepId = null;
    } else {
      observerPanel.classList.remove("hidden");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });
}

function stopObserver() {
  if (!observerTargetStepId) return;
  chrome.runtime.sendMessage({ type: "STOP_OBSERVER" });
  observerTargetStepId = null;
  observerPanel.classList.add("hidden");
}

function clearObserverElements() {
  observerElements = [];
  renderObserverElements();
}

function addObserverElements(elements) {
  observerElements.push(...elements);
  renderObserverElements();
}

function selectObserverElement(idx) {
  const el = observerElements[idx];
  if (!el || !observerTargetStepId) return;
  updateStep(observerTargetStepId, "selector", el.selector);
  updateStep(observerTargetStepId, "selectorIndex", el.selectorIndex);
  renderSteps();
  stopObserver();
}

function renderObserverElements() {
  observerCountEl.textContent = `${observerElements.length} 件`;
  observerElementsContainer.innerHTML = "";
  observerElements.forEach((el, idx) => {
    const item = document.createElement("div");
    item.className = "observer-element-item";
    item.addEventListener("click", () => selectObserverElement(idx));

    // タグ表示
    let tagDisplay = `<${el.tag}`;
    if (el.attrs.id) tagDisplay += ` id="${escapeAttr(el.attrs.id)}"`;
    if (el.attrs.class) tagDisplay += ` class="${escapeAttr(el.attrs.class)}"`;
    if (el.attrs.name) tagDisplay += ` name="${escapeAttr(el.attrs.name)}"`;
    if (el.attrs.value !== undefined)
      tagDisplay += ` value="${escapeAttr(el.attrs.value)}"`;
    if (el.attrs.type) tagDisplay += ` type="${escapeAttr(el.attrs.type)}"`;
    if (el.attrs.href) tagDisplay += ` href="${escapeAttr(el.attrs.href)}"`;
    tagDisplay += `>`;

    const selectorDisplay = el.selectorIndex
      ? `${escapeAttr(el.selector)} (${el.selectorIndex}番目)`
      : escapeAttr(el.selector);

    item.innerHTML = `
      <div class="observer-element-tag">${escapeAttr(tagDisplay)}</div>
      ${el.text ? `<div class="observer-element-text">${escapeAttr(el.text)}</div>` : ""}
      <div class="observer-element-selector">${selectorDisplay}</div>
    `;
    observerElementsContainer.appendChild(item);
  });

  // 最新要素が見えるようにスクロール
  if (observerElements.length > 0) {
    observerElementsContainer.scrollTop =
      observerElementsContainer.scrollHeight;
  }
}

// --- Select Options ---
const selectOptionsPanel = document.getElementById("select-options-panel");
const selectOptionsList = document.getElementById("select-options-list");
let selectOptionsStepId = null;

function showSelectOptions(stepId, options) {
  selectOptionsStepId = stepId;
  selectOptionsList.innerHTML = "";

  options.forEach((opt) => {
    const item = document.createElement("div");
    item.className = "select-option-item" + (opt.selected ? " current" : "");
    item.innerHTML = `
      <span class="select-option-text">${escapeAttr(opt.text)}</span>
      <span class="select-option-value">${escapeAttr(opt.value)}</span>
      ${opt.selected ? '<span class="select-option-current">���在</span>' : ""}
    `;
    item.addEventListener("click", () => selectOption(opt.value));
    selectOptionsList.appendChild(item);
  });

  selectOptionsPanel.classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function selectOption(value) {
  if (!selectOptionsStepId) return;
  updateStep(selectOptionsStepId, "type", "input");
  updateStep(selectOptionsStepId, "value", value);
  renderSteps();
  closeSelectOptions();
}

function closeSelectOptions() {
  selectOptionsStepId = null;
  selectOptionsPanel.classList.add("hidden");
}

// --- Element Picker ---
let pickerTargetStepId = null;
const pickerOverlay = document.getElementById("picker-overlay");

function showPickerOverlay() {
  pickerOverlay.classList.remove("hidden");
}

function hidePickerOverlay() {
  pickerOverlay.classList.add("hidden");
}

function cancelPicker() {
  if (!pickerTargetStepId) return;
  chrome.runtime.sendMessage({ type: "CANCEL_PICKER" });
  pickerTargetStepId = null;
  hidePickerOverlay();
}

async function startPicker(stepId) {
  pickerTargetStepId = stepId;
  // background経由でピッカーを起動
  chrome.runtime.sendMessage({ type: "START_PICKER" }, (response) => {
    if (response && !response.success) {
      alert("ピッカー起動エラー: " + response.error);
      pickerTargetStepId = null;
    } else {
      showPickerOverlay();
    }
  });
}

// --- Execution ---
async function runWorkflow() {
  const wf = getActiveWorkflow();
  if (!wf || wf.steps.length === 0) return;

  isRunning = true;
  showRunnerMode(wf);

  try {
    const response = await chrome.runtime.sendMessage({
      type: "RUN_WORKFLOW",
      workflow: wf,
    });
    if (response && response.error) {
      alert("エラー: " + response.error);
    }
  } catch (err) {
    alert("実行エラー: " + err.message);
  }
}

function stopWorkflow() {
  chrome.runtime.sendMessage({ type: "STOP_WORKFLOW" });
}

function showRunnerMode(wf) {
  els.runnerPanel.classList.remove("hidden");
  els.runnerPanel.classList.remove("collapsed");
  els.runnerPanelBody.classList.remove("hidden");
  els.runnerToggleLabel.textContent = "実行結果を閉じる";
  els.btnRun.classList.add("hidden");
  els.btnStop.classList.remove("hidden");
  els.runnerResult.classList.add("hidden");
  hasRunnerResults = false;
  els.progressText.textContent = "準備中...";
  els.progressFill.style.width = "0%";
  startElapsedTimer();

  // ステップステータス一覧
  els.stepStatusList.innerHTML = "";
  wf.steps.forEach((step, idx) => {
    const div = document.createElement("div");
    div.className = "step-status pending";
    div.id = `step-status-${idx}`;
    const typeLabel =
      { click: "クリック", hover: "ホバー", input: "入力", copy: "コピー" }[
        step.type
      ] || step.type;
    div.innerHTML = `
      <span class="step-status-icon">○</span>
      <span class="step-status-label">Step ${idx + 1}: ${typeLabel} - ${escapeAttr(step.selector || "")}</span>
      <span class="step-status-time"></span>
    `;
    els.stepStatusList.appendChild(div);
  });

  // パネルが見えるようにトップへスクロール
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function closeRunnerPanel() {
  isRunning = false;
  els.btnRun.classList.remove("hidden");
  els.btnStop.classList.add("hidden");
}

function toggleRunnerBody() {
  if (!hasRunnerResults) return;
  const collapsed = els.runnerPanel.classList.toggle("collapsed");
  if (collapsed) {
    els.runnerPanelBody.classList.add("hidden");
    els.runnerToggleLabel.textContent = "実行結果を開く";
  } else {
    els.runnerPanelBody.classList.remove("hidden");
    els.runnerToggleLabel.textContent = "実行結果を閉じる";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function updateStepProgress(currentStep, totalSteps) {
  const pct = Math.round((currentStep / totalSteps) * 100);
  els.progressText.textContent = `実行中: Step ${currentStep + 1} / ${totalSteps}`;
  els.progressFill.style.width = `${pct}%`;

  // 前のステップの時間を確定
  freezeStepTime();

  // ステータス更新
  for (let i = 0; i < totalSteps; i++) {
    const el = document.getElementById(`step-status-${i}`);
    if (!el) continue;
    if (i < currentStep) {
      el.className = "step-status done";
      el.querySelector(".step-status-icon").textContent = "\u2713";
    } else if (i === currentStep) {
      el.className = "step-status running";
      el.querySelector(".step-status-icon").textContent = "\u23f3";
    } else {
      el.className = "step-status pending";
      el.querySelector(".step-status-icon").textContent = "\u25cb";
    }
  }

  // 現在のステップのタイマー開始
  startStepTimer(currentStep);
}

function showWorkflowComplete(copyResults, stopped) {
  els.btnStop.classList.add("hidden");
  stopElapsedTimer();
  freezeStepTime();
  const elapsed = formatElapsed();

  if (stopped) {
    // 停止時: エラー・未実行のステータスをそのまま保持し、実行中だったステップは未実行に戻す
    els.progressText.textContent = `停止しました (${elapsed})`;
    const statusEls = els.stepStatusList.querySelectorAll(
      ".step-status.running",
    );
    statusEls.forEach((el) => {
      el.className = "step-status pending";
      el.querySelector(".step-status-icon").textContent = "\u25cb";
    });
  } else {
    // 正常完了: 全ステップを完了表示
    els.progressText.textContent = `完了 (${elapsed})`;
    els.progressFill.style.width = "100%";
    const statusEls = els.stepStatusList.querySelectorAll(".step-status");
    statusEls.forEach((el) => {
      el.className = "step-status done";
      el.querySelector(".step-status-icon").textContent = "\u2713";
    });
  }

  // コピー結果表示
  if (copyResults && copyResults.length > 0) {
    els.runnerResult.classList.remove("hidden");
    els.copyResult.value = formatCopyResults(copyResults);
  }

  // 実行ボタンを復帰
  els.btnRun.classList.remove("hidden");
  hasRunnerResults = true;
  els.runnerToggleLabel.textContent = "実行結果を閉じる";
}

function showStepError(stepIndex, errorMessage) {
  const el = document.getElementById(`step-status-${stepIndex}`);
  if (el) {
    el.className = "step-status error";
    el.querySelector(".step-status-icon").textContent = "\u2717";
  }
}

// --- Elapsed Timer ---
function formatElapsed() {
  if (!elapsedStartTime) return "0.0s";
  const ms = Date.now() - elapsedStartTime;
  const sec = ms / 1000;
  return sec < 60
    ? sec.toFixed(1) + "s"
    : Math.floor(sec / 60) +
        "m" +
        Math.floor(sec % 60)
          .toString()
          .padStart(2, "0") +
        "s";
}

function startElapsedTimer() {
  stopElapsedTimer();
  elapsedStartTime = Date.now();
  els.elapsedTime.textContent = "0.0s";
  elapsedTimerId = setInterval(() => {
    els.elapsedTime.textContent = formatElapsed();
  }, 100);
}

function stopElapsedTimer() {
  if (elapsedTimerId) {
    clearInterval(elapsedTimerId);
    elapsedTimerId = null;
  }
}

function formatStepElapsed() {
  if (!stepStartTime) return "";
  const sec = (Date.now() - stepStartTime) / 1000;
  return sec.toFixed(1) + "s";
}

function startStepTimer(stepIndex) {
  stopStepTimer();
  stepStartTime = Date.now();
  const timeEl = document.querySelector(
    `#step-status-${stepIndex} .step-status-time`,
  );
  if (!timeEl) return;
  timeEl.textContent = "0.0s";
  stepTimerId = setInterval(() => {
    timeEl.textContent = formatStepElapsed();
  }, 100);
}

function stopStepTimer() {
  if (stepTimerId) {
    clearInterval(stepTimerId);
    stepTimerId = null;
  }
}

function freezeStepTime() {
  if (!stepStartTime) return;
  stopStepTimer();
  stepStartTime = null;
}

function formatCopyResults(results) {
  const hasAnyLabel = results.some((r) => r.label);
  if (hasAnyLabel) {
    return results
      .map((r) => {
        const labelLine = r.label ? `■${r.label}` : "■";
        return `${labelLine}\n${r.text}`;
      })
      .join("\n");
  } else {
    return results.map((r) => r.text).join("\n");
  }
}

// --- Import / Export ---
function exportWorkflow() {
  const wf = getActiveWorkflow();
  if (!wf) return;

  const data = JSON.stringify(wf, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${wf.name || "workflow"}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importWorkflow(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);

      // バリデーション
      if (!data.name || typeof data.name !== "string")
        throw new Error("name が不正です");
      if (typeof data.interval !== "number" || data.interval < 0)
        throw new Error("interval が不正です");
      if (!Array.isArray(data.steps)) throw new Error("steps が不正です");

      for (const step of data.steps) {
        if (!["click", "hover", "input", "copy"].includes(step.type)) {
          throw new Error(`不正なステップタイプ: ${step.type}`);
        }
        if (!step.selector || typeof step.selector !== "string") {
          throw new Error("selector が不正です");
        }
        if (
          step.type === "input" &&
          (step.value === undefined || typeof step.value !== "string")
        ) {
          throw new Error("input ステップに value が必要です");
        }
      }

      // 新しいIDを付与してインポート
      const imported = {
        id: generateId(),
        name: data.name,
        interval: data.interval,
        stopOnError: !!data.stopOnError,
        steps: data.steps.map((s) => ({
          ...s,
          id: generateId(),
        })),
      };

      workflows.push(imported);
      activeWorkflowId = imported.id;
      saveToStorage();
      renderAll();
    } catch (err) {
      alert("インポートエラー: " + err.message);
    }
  };
  reader.readAsText(file);
}

// --- Message Listener (from background) ---
chrome.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case "STEP_PROGRESS":
      updateStepProgress(message.currentStep, message.totalSteps);
      break;
    case "STEP_ERROR":
      showStepError(message.stepIndex, message.error);
      break;
    case "WORKFLOW_COMPLETE":
      showWorkflowComplete(message.copyResults, false);
      break;
    case "WORKFLOW_STOPPED":
      showWorkflowComplete(message.copyResults, true);
      break;
    case "OBSERVER_RESULT":
      if (observerTargetStepId) {
        addObserverElements(message.elements);
      }
      break;
    case "PICKER_RESULT":
      if (pickerTargetStepId) {
        updateStep(pickerTargetStepId, "selector", message.selector);
        updateStep(pickerTargetStepId, "selectorIndex", message.selectorIndex);
        renderSteps();

        if (message.selectOptions && message.selectOptions.length > 0) {
          showSelectOptions(pickerTargetStepId, message.selectOptions);
        }

        pickerTargetStepId = null;
        hidePickerOverlay();
      }
      break;
  }
});

// --- Picker Cancel ---
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && pickerTargetStepId) {
    e.preventDefault();
    cancelPicker();
  }
});

pickerOverlay.addEventListener("click", () => {
  cancelPicker();
});

// --- Observer Controls ---
document
  .getElementById("btn-observer-stop")
  .addEventListener("click", stopObserver);
document
  .getElementById("btn-observer-clear")
  .addEventListener("click", clearObserverElements);

// --- Select Options Controls ---
document
  .getElementById("btn-select-options-close")
  .addEventListener("click", closeSelectOptions);

// --- Event Listeners ---
els.workflowSelect.addEventListener("change", (e) =>
  switchWorkflow(e.target.value),
);
els.btnReorderWorkflow.addEventListener("click", toggleWorkflowReorder);
els.btnReorderDone.addEventListener("click", () =>
  els.workflowReorder.classList.add("hidden"),
);
els.btnNewWorkflow.addEventListener("click", createNewWorkflow);
els.btnDeleteWorkflow.addEventListener("click", () => {
  if (workflows.length <= 1) {
    alert("最後のワークフローは削除できません");
    return;
  }
  if (confirm("このワークフローを削除しますか？")) {
    deleteActiveWorkflow();
  }
});

els.workflowName.addEventListener("input", (e) => {
  const wf = getActiveWorkflow();
  if (wf) {
    wf.name = e.target.value;
    saveToStorage();
    renderWorkflowSelect();
  }
});

els.workflowInterval.addEventListener("input", (e) => {
  const wf = getActiveWorkflow();
  if (wf) {
    wf.interval = parseInt(e.target.value, 10) || 0;
    saveToStorage();
  }
});

els.workflowStopOnError.addEventListener("change", (e) => {
  const wf = getActiveWorkflow();
  if (wf) {
    wf.stopOnError = e.target.checked;
    saveToStorage();
  }
});

els.btnAddStep.addEventListener("click", addStep);
els.btnRun.addEventListener("click", runWorkflow);
els.btnStop.addEventListener("click", stopWorkflow);
els.runnerPanelHeader.addEventListener("click", toggleRunnerBody);
els.btnCopyResult.addEventListener("click", () => {
  const text = els.copyResult.value;
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    els.btnCopyResult.textContent = "コピー済";
    els.btnCopyResult.classList.add("copied");
    setTimeout(() => {
      els.btnCopyResult.textContent = "コピー";
      els.btnCopyResult.classList.remove("copied");
    }, 1500);
  });
});
els.btnDuplicateWorkflow.addEventListener("click", duplicateActiveWorkflow);
els.btnExport.addEventListener("click", exportWorkflow);
els.btnImport.addEventListener("click", () => els.fileImport.click());
els.fileImport.addEventListener("change", (e) => {
  if (e.target.files.length > 0) {
    importWorkflow(e.target.files[0]);
    e.target.value = "";
  }
});

// --- Init ---
loadFromStorage().then(renderAll);
