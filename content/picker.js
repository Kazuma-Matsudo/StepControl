// ========================================
// StepFlow - Element Picker
// ========================================

(function () {
  // 多重起動防止 & 再起動対応
  if (window.__stepFlowPickerActive) {
    window.__stepFlowPickerCleanup();
  }
  window.__stepFlowPickerActive = true;

  let hoveredElement = null;

  // 全画面透明オーバーレイ（ページ側のイベントを完全にブロック）
  const overlay = document.createElement("div");
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    z-index: 2147483646; background: transparent; cursor: crosshair;
  `;

  // ハイライト表示
  const highlight = document.createElement("div");
  highlight.style.cssText = `
    position: fixed; pointer-events: none; z-index: 2147483647;
    border: 2px solid #4a90d9; background: rgba(74, 144, 217, 0.15);
    border-radius: 2px; transition: all 0.05s; display: none;
  `;

  // セレクタツールチップ
  const tooltip = document.createElement("div");
  tooltip.style.cssText = `
    position: fixed; z-index: 2147483647; pointer-events: none;
    background: #333; color: #fff; font-size: 12px; font-family: monospace;
    padding: 4px 8px; border-radius: 4px; white-space: nowrap;
    max-width: 400px; overflow: hidden; text-overflow: ellipsis; display: none;
  `;

  document.documentElement.appendChild(overlay);
  document.documentElement.appendChild(highlight);
  document.documentElement.appendChild(tooltip);

  // --- イベントハンドラ ---
  function updateHighlight(el) {
    hoveredElement = el;
    const rect = el.getBoundingClientRect();

    highlight.style.display = "block";
    highlight.style.top = rect.top + "px";
    highlight.style.left = rect.left + "px";
    highlight.style.width = rect.width + "px";
    highlight.style.height = rect.height + "px";

    const { selector, selectorIndex } = buildSelectorWithIndex(el);
    tooltip.textContent = selectorIndex
      ? `${selector} (${selectorIndex}番目)`
      : selector;
    tooltip.style.display = "block";

    // ツールチップ位置
    let tooltipTop = rect.bottom + 6;
    if (tooltipTop + 30 > window.innerHeight) {
      tooltipTop = rect.top - 30;
    }
    let tooltipLeft = rect.left;
    if (tooltipLeft + 300 > window.innerWidth) {
      tooltipLeft = window.innerWidth - 310;
    }
    tooltip.style.top = Math.max(0, tooltipTop) + "px";
    tooltip.style.left = Math.max(0, tooltipLeft) + "px";
  }

  function onMouseMove(e) {
    // オーバーレイ・ハイライト・ツールチップを一時非表示にしてelementFromPointで要素取得
    overlay.style.display = "none";
    highlight.style.display = "none";
    tooltip.style.display = "none";
    const el = document.elementFromPoint(e.clientX, e.clientY);
    overlay.style.display = "";
    if (el) {
      updateHighlight(el);
    }
  }

  function onPointerDown(e) {
    e.preventDefault();
    e.stopPropagation();

    if (!hoveredElement) return;

    const { selector, selectorIndex } = buildSelectorWithIndex(hoveredElement);

    // <select>の場合、オプション一覧を収集
    let selectOptions = null;
    if (hoveredElement.tagName === "SELECT") {
      selectOptions = Array.from(hoveredElement.options).map((opt) => ({
        value: opt.value,
        text: opt.textContent.trim(),
        selected: opt.selected,
      }));
    }

    cleanup();

    // 結果をbackgroundに送信
    chrome.runtime.sendMessage({
      type: "PICKER_RESULT",
      selector,
      selectorIndex,
      selectOptions,
    });
  }

  function onKeyDown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      cleanup();
    }
  }

  // イベントはオーバーレイで受け取る（ページ側のハンドラに影響されない）
  overlay.addEventListener("mousemove", onMouseMove);
  overlay.addEventListener("pointerdown", onPointerDown);
  // Escキーはdocumentのcaptureで受ける（overlayはfocusを持たないため）
  document.addEventListener("keydown", onKeyDown, true);

  // サイドパネルからのキャンセルメッセージを受け取る
  function onMessage(msg) {
    if (msg.type === "CANCEL_PICKER") {
      cleanup();
    }
  }
  chrome.runtime.onMessage.addListener(onMessage);

  // クリーンアップ
  function cleanup() {
    chrome.runtime.onMessage.removeListener(onMessage);
    document.removeEventListener("keydown", onKeyDown, true);
    overlay.remove();
    highlight.remove();
    tooltip.remove();
    window.__stepFlowPickerActive = false;
    delete window.__stepFlowPickerCleanup;
  }

  // 外部からクリーンアップ可能にする
  window.__stepFlowPickerCleanup = cleanup;

  // --- セレクタ生成 ---

  // セレクタとインデックスを返す（同一セレクタの何番目かを自動算出）
  function buildSelectorWithIndex(el) {
    // 1. idがあれば最優先（常にユニーク）
    if (el.id) {
      return { selector: `#${cssEscape(el.id)}`, selectorIndex: null };
    }

    // 2. クラスの組み合わせ
    if (el.classList.length > 0) {
      const classSelector =
        el.tagName.toLowerCase() +
        Array.from(el.classList)
          .map((c) => `.${cssEscape(c)}`)
          .join("");
      const classIndex = findIndexAmong(classSelector, el);
      if (classIndex !== null) {
        return {
          selector: classSelector,
          selectorIndex: classIndex === 1 ? null : classIndex,
        };
      }
    }

    // 3. name属性（フォーム要素）
    const name = el.getAttribute("name");
    if (name) {
      const nameSelector = `${el.tagName.toLowerCase()}[name="${cssEscape(name)}"]`;
      const nameIndex = findIndexAmong(nameSelector, el);
      if (nameIndex !== null) {
        return {
          selector: nameSelector,
          selectorIndex: nameIndex === 1 ? null : nameIndex,
        };
      }
    }

    // 4. data属性
    for (const attr of el.attributes) {
      if (attr.name.startsWith("data-") && attr.value) {
        const dataSelector = `${el.tagName.toLowerCase()}[${attr.name}="${cssEscape(attr.value)}"]`;
        const dataIndex = findIndexAmong(dataSelector, el);
        if (dataIndex !== null) {
          return {
            selector: dataSelector,
            selectorIndex: dataIndex === 1 ? null : dataIndex,
          };
        }
      }
    }

    // 5. タグ名のみで試行
    const tagSelector = el.tagName.toLowerCase();
    const tagIndex = findIndexAmong(tagSelector, el);
    if (tagIndex !== null) {
      return {
        selector: tagSelector,
        selectorIndex: tagIndex === 1 ? null : tagIndex,
      };
    }

    // 6. 親からのパスを構築（フォールバック、常にユニーク）
    return { selector: buildPathSelector(el), selectorIndex: null };
  }

  // セレクタに一致する要素群の中で、elが何番目か（1-based）を返す。見つからなければnull
  function findIndexAmong(selector, el) {
    try {
      const elements = document.querySelectorAll(selector);
      for (let i = 0; i < elements.length; i++) {
        if (elements[i] === el) {
          return i + 1; // 1-based
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  function buildSelector(el) {
    return buildSelectorWithIndex(el).selector;
  }

  function buildPathSelector(el) {
    const parts = [];
    let current = el;

    while (
      current &&
      current !== document.body &&
      current !== document.documentElement
    ) {
      let part = current.tagName.toLowerCase();

      if (current.id) {
        parts.unshift(`#${cssEscape(current.id)}`);
        break;
      }

      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (c) => c.tagName === current.tagName,
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          part += `:nth-of-type(${index})`;
        }
      }

      parts.unshift(part);
      current = current.parentElement;

      if (parts.length >= 4) break;
    }

    return parts.join(" > ");
  }

  function isUnique(selector) {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  }

  function cssEscape(str) {
    if (typeof CSS !== "undefined" && CSS.escape) {
      return CSS.escape(str);
    }
    return str.replace(/([!"#$%&'()*+,.\/:;<=>?@[\]^`{|}~])/g, "\\$1");
  }
})();
