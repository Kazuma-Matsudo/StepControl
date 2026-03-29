// ========================================
// StepFlow - DOM Observer
// MutationObserverで新規DOM要素を検知し、サイドパネルに送信
// ========================================

(function () {
  // 多重起動防止 & 再起動対応
  if (window.__stepFlowObserverActive) {
    window.__stepFlowObserverCleanup();
  }
  window.__stepFlowObserverActive = true;

  // 監視開始時点の既存要素をスナップショット
  const existingElements = new WeakSet();
  document.querySelectorAll("*").forEach((el) => existingElements.add(el));

  const observer = new MutationObserver((mutations) => {
    const newElements = [];

    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (existingElements.has(node)) continue;

        // 自身と子孫を収集
        collectVisibleElements(node, newElements);
      }
    }

    if (newElements.length > 0) {
      chrome.runtime.sendMessage({
        type: "OBSERVER_RESULT",
        elements: newElements,
      });
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // 可視要素のみ収集（スクリプトやスタイル要素を除外）
  function collectVisibleElements(root, results) {
    const ignoreTags = new Set([
      "SCRIPT",
      "STYLE",
      "LINK",
      "META",
      "BR",
      "HR",
      "NOSCRIPT",
    ]);

    function walk(el) {
      if (ignoreTags.has(el.tagName)) return;

      const info = buildElementInfo(el);
      if (info) {
        results.push(info);
      }

      // 子要素も走査（option等を拾うため）
      for (const child of el.children) {
        walk(child);
      }
    }

    walk(root);
  }

  // 要素の情報を構築
  function buildElementInfo(el) {
    const tag = el.tagName.toLowerCase();
    const text = getDirectText(el).trim();
    const attrs = {};

    // 主要な属性を取得
    if (el.id) attrs.id = el.id;
    if (el.className && typeof el.className === "string")
      attrs.class = el.className;
    if (el.getAttribute("name")) attrs.name = el.getAttribute("name");
    if (el.getAttribute("value") !== null)
      attrs.value = el.getAttribute("value");
    if (el.getAttribute("href")) attrs.href = el.getAttribute("href");
    if (el.getAttribute("type")) attrs.type = el.getAttribute("type");
    if (el.getAttribute("role")) attrs.role = el.getAttribute("role");
    if (el.getAttribute("aria-label"))
      attrs["aria-label"] = el.getAttribute("aria-label");

    // data属性
    for (const attr of el.attributes) {
      if (attr.name.startsWith("data-") && attr.value) {
        attrs[attr.name] = attr.value;
      }
    }

    // テキストも属性もない要素は子要素がある場合のみ含める（コンテナとして）
    if (
      !text &&
      Object.keys(attrs).length <= (el.className ? 1 : 0) &&
      el.children.length === 0
    ) {
      return null;
    }

    // セレクタを生成
    const selector = buildSelector(el);

    return {
      tag,
      text: text.substring(0, 200), // 長すぎるテキストは切り詰め
      attrs,
      selector,
      selectorIndex: findSelectorIndex(selector, el),
    };
  }

  // 直接のテキストノードのみ取得（子要素のテキストは除外）
  function getDirectText(el) {
    let text = "";
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      }
    }
    return text;
  }

  // セレクタ生成（picker.jsと同様のロジック）
  function buildSelector(el) {
    if (el.id) {
      return `#${cssEscape(el.id)}`;
    }

    if (el.classList.length > 0) {
      const classSelector =
        el.tagName.toLowerCase() +
        Array.from(el.classList)
          .map((c) => `.${cssEscape(c)}`)
          .join("");
      try {
        if (document.querySelectorAll(classSelector).length > 0) {
          return classSelector;
        }
      } catch {
        /* ignore */
      }
    }

    const name = el.getAttribute("name");
    if (name) {
      const nameSelector = `${el.tagName.toLowerCase()}[name="${cssEscape(name)}"]`;
      try {
        if (document.querySelectorAll(nameSelector).length > 0) {
          return nameSelector;
        }
      } catch {
        /* ignore */
      }
    }

    for (const attr of el.attributes) {
      if (attr.name.startsWith("data-") && attr.value) {
        const dataSelector = `${el.tagName.toLowerCase()}[${attr.name}="${cssEscape(attr.value)}"]`;
        try {
          if (document.querySelectorAll(dataSelector).length > 0) {
            return dataSelector;
          }
        } catch {
          /* ignore */
        }
      }
    }

    return el.tagName.toLowerCase();
  }

  function findSelectorIndex(selector, el) {
    try {
      const elements = document.querySelectorAll(selector);
      for (let i = 0; i < elements.length; i++) {
        if (elements[i] === el) {
          return i + 1 === 1 ? null : i + 1;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  function cssEscape(str) {
    if (typeof CSS !== "undefined" && CSS.escape) {
      return CSS.escape(str);
    }
    return str.replace(/([!"#$%&'()*+,.\/:;<=>?@[\]^`{|}~])/g, "\\$1");
  }

  // サイドパネルからの停止メッセージを受け取る
  function onMessage(msg) {
    if (msg.type === "STOP_OBSERVER") {
      cleanup();
    }
  }
  chrome.runtime.onMessage.addListener(onMessage);

  function cleanup() {
    observer.disconnect();
    chrome.runtime.onMessage.removeListener(onMessage);
    window.__stepFlowObserverActive = false;
    delete window.__stepFlowObserverCleanup;
  }

  window.__stepFlowObserverCleanup = cleanup;
})();
