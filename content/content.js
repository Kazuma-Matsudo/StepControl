// ========================================
// StepFlow - Content Script
// ========================================

// 多重インジェクト防止
if (!window.__stepFlowInjected) {
  window.__stepFlowInjected = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== "EXECUTE_STEP") return;

    const step = message.step;
    try {
      const result = executeStep(step);
      sendResponse({ success: true, data: result });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
    return true;
  });
}

function executeStep(step) {
  const index =
    step.selectorIndex != null && step.selectorIndex >= 2
      ? step.selectorIndex - 1
      : 0;
  const elements = document.querySelectorAll(step.selector);
  if (elements.length === 0) {
    throw new Error(`要素が見つかりません: ${step.selector}`);
  }
  if (index >= elements.length) {
    throw new Error(
      `${step.selector} の ${step.selectorIndex} 番目が見つかりません（該当: ${elements.length}個）`,
    );
  }
  const element = elements[index];

  switch (step.type) {
    case "click":
      return executeClick(element);
    case "hover":
      return executeHover(element);
    case "input":
      return executeInput(element, step.value);
    case "copy":
      return executeCopy(element);
    default:
      throw new Error(`不明なステップタイプ: ${step.type}`);
  }
}

// --- Click ---
function executeClick(element) {
  element.click();
  return {};
}

// --- Hover ---
function executeHover(element) {
  element.dispatchEvent(
    new MouseEvent("mouseenter", { bubbles: true, cancelable: true }),
  );
  element.dispatchEvent(
    new MouseEvent("mouseover", { bubbles: true, cancelable: true }),
  );
  return {};
}

// --- Input ---
function executeInput(element, value) {
  element.focus();
  element.value = value;
  // React等のフレームワーク対応: input/changeイベントを発火
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  return {};
}

// --- Copy ---
function executeCopy(element) {
  const text = element.textContent.trim();

  // <a>タグの場合、hrefを取得してテキスト(URL)形式にする
  if (element.tagName === "A" && element.href) {
    const href = element.href;
    // テキストとURLが異なる場合のみ「テキスト(URL)」形式
    if (text !== href) {
      return { text: `${text}(${href})` };
    }
  }

  return { text };
}
